declare module "@3d-dice/dice-parser-interface" {
  export interface DieGroup {
    qty: number;
    sides: number | string;
    mods: unknown[];
  }

  export interface DieGroupWithRolls extends DieGroup {
    rolls: { sides: number | string; value: number }[];
  }

  export interface DieRollResult {
    die: number;
    roll: number;
    value: number;
    drop?: boolean;
    valid: boolean;
  }

  export interface FinalRollResult {
    value: number;
    rolls?: DieRollResult[];
    dice?: FinalRollResult[];
    [key: string]: unknown;
  }

  export default class DiceParser {
    constructor(options?: {
      targetRollsCrit?: boolean;
      targetRollsCritSuccess?: boolean;
      targetRollsCritFailure?: boolean;
    });
    parseNotation(notation: string): DieGroup[];
    handleRerolls(rollResults: unknown[]): unknown[];
    parseFinalResults(rollResults: DieGroupWithRolls[]): FinalRollResult;
  }
}
