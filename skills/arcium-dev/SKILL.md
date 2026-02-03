---
name: arcium-dev
description: End-to-end Arcium development for Arcis MPC circuits, Solana program integration, TypeScript client/tests, and simple webapp harnesses. Use when building or debugging Arcium apps: installation/arcup setup, Arcium.toml config, encrypted instructions, ArgBuilder + callbacks, computation lifecycle, encryption/sealing, TS SDK usage, or when adapting Arcium examples.
---

# Arcium Dev

## Overview

Use this skill to design, implement, and test Arcium applications from circuit to program to client. Prefer a minimal, end-to-end slice: Arcis circuit + Solana program integration + TS test harness + tiny UI for manual verification.

## Default stack decisions (opinionated)

1. **Circuits**: Arcis for MPC circuits with `#[encrypted]` + `#[instruction]`.
2. **Program**: Anchor-based Solana program invoking Arcium computations via SDK macros.
3. **Client/tests**: TypeScript tests using `@arcium-hq/client`; use `@arcium-hq/reader` only for read-only network checks.
4. **UI**: Minimal harness (simple React/Vite or plain TS/HTML) to submit encrypted inputs and view results.

## Workflow (use this every time)

1. **Classify the change**: Arcis circuit, Rust program integration, TS client/tests, or UI harness (often multiple).
2. **Confirm environment**: Arcium CLI installed, `Arcium.toml` and `Anchor.toml` present, cluster config known.
3. **Circuit first**: Add or modify `#[encrypted]` modules and `#[instruction]` fns; keep input/output types explicit.
4. **Program integration**: Queue computation and register callbacks; wire required accounts macros.
5. **Client/tests**: Encrypt inputs, invoke computation, track callback, decode outputs.
6. **UI harness (optional)**: Add a small UI to send inputs and display status/results.
7. **Tests**: Add or update a TS test that exercises the full flow on local cluster.

## Arcis circuit guidance

1. Use `#[encrypted]` module and mark MPC entrypoints with `#[instruction]`.
2. Model encrypted inputs/outputs with `Enc<Shared, T>` or `Enc<Mxe, T>` types.
3. Convert ciphertexts to secret shares with `to_arcis()` and re-encrypt with `owner.from_arcis(...)`.
4. Keep circuits deterministic and explicit; avoid dynamic control flow that cannot be expressed in a fixed circuit.
5. Validate types and operations against the Arcis references before coding complex logic.

## Rust program integration guidance

1. Use `queue_computation_accounts` and `callback_accounts` macros for account wiring.
2. Build encrypted args using `ArgBuilder`.
3. For `Enc<Shared, T>` inputs: pass `x25519_pubkey(pub_key)` and `plaintext_u128(nonce)` before ciphertexts.
4. For `Enc<Mxe, T>` inputs: pass `plaintext_u128(nonce)` before ciphertexts.
5. Define callback instructions with `#[arcium_callback(encrypted_ix = "...")]`.
6. Callback signature must be `fn(ctx: Context<...>, output: SignedComputationOutputs<EncryptedIxOutput>)`.
7. Always verify outputs in the callback before emitting events or using values.

## TypeScript client/tests guidance

1. Use `@arcium-hq/client` for encryption, building confidential transactions, and tracking callbacks.
2. Use `@arcium-hq/reader` only for read-only network inspection.
3. Keep tests end-to-end: encrypt inputs, invoke computation, wait for callback, decode outputs.
4. Mirror the exact encrypted input structure expected by the Arcis instruction.

## UI harness guidance

1. Keep UI minimal: a form for inputs, a button to submit, a status panel for callback results.
2. Do not persist secrets or plaintexts; keep them in memory only for demos.
3. Make the encryption step explicit in the UI to avoid confusion when debugging.

## References (read when needed)

1. `references/docs.md` for the authoritative Arcium doc map and key pages.
2. `references/repos.md` for Arcium GitHub repositories and example app pointers.
