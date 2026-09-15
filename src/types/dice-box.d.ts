declare module "@3d-dice/dice-box" {
  export interface DiceBoxConfig {
    container?: string;
    id?: string;
    assetPath: string;
    scale?: number;
    gravity?: number;
    theme?: string;
    themeColor?: string;
    offscreen?: boolean;
    [key: string]: unknown;
  }

  export interface DiceResult {
    sides: number | string;
    value: number;
    groupId?: number;
    rollId?: number;
  }

  export interface DiceGroupInput {
    qty: number;
    sides: number | string;
    mods?: unknown[];
  }

  export default class DiceBox {
    constructor(config: DiceBoxConfig);
    init(): Promise<unknown>;
    roll(
      notation: string | string[] | DiceGroupInput[],
    ): Promise<DiceResult[]>;
    add(notation: string | string[] | object): Promise<DiceResult[]>;
    clear(): void;
    hide(hideClass?: string): void;
    show(): void;
    // Swaps theme/themeColor/etc. on an already-initialized box — re-fetches
    // that theme's assets under the hood, no need to recreate the instance.
    updateConfig(config: Partial<DiceBoxConfig>): void;
    onRollComplete: (results: DiceResult[]) => void;
  }
}
