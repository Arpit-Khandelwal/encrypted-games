use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct AddInputValues {
        v1: u8,
        v2: u8,
    }

    #[instruction]
    pub fn add_together(input_ctxt: Enc<Shared, AddInputValues>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.v1 as u16 + input.v2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }

    pub struct InputValues {
        secret: [u8; 4],
        guess: [u8; 4],
    }

    // Wordle-style feedback per digit:
    // 2 = green (correct digit + position)
    // 1 = yellow (digit exists elsewhere, with duplicate handling)
    // 0 = red (digit not present)
    #[instruction]
    pub fn score_guess(input_ctxt: Enc<Shared, InputValues>) -> Enc<Shared, [u8; 4]> {
        let input = input_ctxt.to_arcis();
        let secret = input.secret;
        let guess = input.guess;

        let mut colors = [0u8; 4];
        let mut green = [false; 4];

        for i in 0..4 {
            green[i] = guess[i] == secret[i];
            colors[i] = if green[i] { 2 } else { 0 };
        }

        // Greedy match remaining digits (left-to-right) to remaining secret slots.
        let mut used_secret = [false; 4];
        for j in 0..4 {
            used_secret[j] = green[j];
        }

        for i in 0..4 {
            if !green[i] {
                let mut matched = false;
                for j in 0..4 {
                    if !matched && !used_secret[j] && guess[i] == secret[j] {
                        matched = true;
                        used_secret[j] = true;
                    }
                }
                if matched {
                    colors[i] = 1;
                }
            }
        }

        input_ctxt.owner.from_arcis(colors)
    }
}
