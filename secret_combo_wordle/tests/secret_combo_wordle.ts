import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AddressLookupTableProgram, PublicKey } from "@solana/web3.js";
import { SecretComboWordle } from "../target/types/secret_combo_wordle";
import { randomBytes } from "crypto";
import {
  ARCIUM_IDL,
  awaitComputationFinalization,
  buildFinalizeCompDefTx,
  deserializeLE,
  getArciumAccountBaseSeed,
  getArciumEnv,
  getArciumProgram,
  getArciumProgramId,
  getCircuitState,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getLookupTableAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  RescueCipher,
  uploadCircuit,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const runWordle = process.env.RUN_WORDLE === "1";
const wordleDescribe = runWordle ? describe : describe.skip;

wordleDescribe("SecretComboWordle", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .SecretComboWordle as Program<SecretComboWordle>;
  const provider = anchor.getProvider();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("Scores a Wordle-style 4-digit guess", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing score_guess computation definition");
    const initSig = await initScoreGuessCompDef(program, owner);
    console.log("score_guess comp def init tx", initSig);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
    );

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Secret: 1 2 3 4
    // Guess:  1 4 2 9
    // Expected colors: [2,1,1,0]
    const secret = [1n, 2n, 3n, 4n];
    const guess = [1n, 4n, 2n, 9n];
    const plaintext = [...secret, ...guess];

    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const scoreEventPromise = awaitEvent("scoreEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueSig = await program.methods
      .scoreGuess(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(ciphertext[2]),
        Array.from(ciphertext[3]),
        Array.from(ciphertext[4]),
        Array.from(ciphertext[5]),
        Array.from(ciphertext[6]),
        Array.from(ciphertext[7]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString()),
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset,
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("score_guess")).readUInt32LE(),
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Queue sig is", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log("Finalize sig is", finalizeSig);

    const scoreEvent = await scoreEventPromise;
    const decrypted = cipher.decrypt(
      [scoreEvent.c0, scoreEvent.c1, scoreEvent.c2, scoreEvent.c3],
      scoreEvent.nonce,
    );
    const colors = decrypted.map((x) => Number(x));
    expect(colors).to.deep.equal([2, 1, 1, 0]);
  });
});

async function initScoreGuessCompDef(
  program: Program<SecretComboWordle>,
  owner: anchor.web3.Keypair,
): Promise<string> {
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount",
  );
  const offset = getCompDefAccOffset("score_guess");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];

  let sig = "";
  try {
    sig = await program.methods
      .initScoreGuessCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
        addressLookupTable: await getMxeLookupTableAddress(
          provider,
          program.programId,
        ),
        lutProgram: AddressLookupTableProgram.programId,
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
  } catch (e) {
    // If already initialized, we'll just continue with upload/finalize checks below.
    console.log("initScoreGuessCompDef skipped:", e);
  }

  const arciumProgram = getArciumProgram(provider);
  const compDefAcc: any =
    await arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA);
  const state = getCircuitState(compDefAcc.circuitSource);
  if (state === "OnchainPending") {
    const rawCircuit = fs.readFileSync("build/score_guess.arcis");
    // Default parallelism (500) will trigger RPC rate limits; keep it low.
    await uploadCircuit(provider, "score_guess", program.programId, rawCircuit, true, 1);
  }

  // If uploadCircuit brought it to UploadComplete, finalize; if already finalized, this will error/skip.
  try {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId,
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    finalizeTx.sign(owner);
    await provider.sendAndConfirm(finalizeTx);
  } catch (e) {
    console.log("Finalize comp def skipped:", e);
  }

  return sig;
}

async function getMxeLookupTableAddress(
  provider: anchor.AnchorProvider,
  mxeProgramId: PublicKey,
): Promise<PublicKey> {
  const arciumProgram = getArciumProgram(provider);
  const mxeAccAddress = getMXEAccAddress(mxeProgramId);
  const mxeAcc: any = await arciumProgram.account.mxeAccount.fetch(mxeAccAddress);
  const lutOffset = mxeAcc.lutOffsetSlot as anchor.BN;

  return getLookupTableAddress(mxeProgramId, lutOffset);
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 60,
  retryDelayMs: number = 1000,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}
