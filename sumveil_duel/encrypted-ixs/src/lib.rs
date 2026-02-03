use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct DuelInputs {
        p1: u8,
        p2: u8,
    }

    #[instruction]
    pub fn sum_duel(input_ctxt: Enc<Shared, DuelInputs>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.p1 as u16 + input.p2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }
}
