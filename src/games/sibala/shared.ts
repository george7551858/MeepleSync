import type { SharedGame } from "../../shared/game";
import type { SessionView } from "../../shared/protocol";

/**
 * 十八骰仔 (Si-ba-la / 十八啦): each player rolls 4 six-sided dice (⚀⚁⚂⚃⚄⚅) in turn order.
 *
 * Scoring 4 dice:
 * - Four of a kind (一色 / 豹子, e.g. ⚅ ⚅ ⚅ ⚅): beats any point score, ranked by face (⚅ > ⚄ > ⚃ > ⚂ > ⚁ > ⚀).
 * - At least one pair (點數): set aside one pair (if two pairs, set aside the smaller pair) and sum the other two dice
 *   for 3–12 points (12 points = 十八, 3 points = BG).
 * - All 4 different or 3 of a kind (無點): no valid score; the player rolls again.
 */

export const DICE_FACES = [1, 2, 3, 4, 5, 6] as const;
export type Die = (typeof DICE_FACES)[number];
export type Dice = [Die, Die, Die, Die];

export const DIE_SYMBOL: Record<Die, string> = {
  1: "⚀",
  2: "⚁",
  3: "⚂",
  4: "⚃",
  5: "⚄",
  6: "⚅",
};

export const DICE_SYMBOLS = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"] as const;

export const ROLL_TEXT = "十八啦";

export function diceSymbols(dice: readonly Die[]): string {
  return dice.map((d) => DIE_SYMBOL[d]).join(" ");
}

export function isRollText(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed === ROLL_TEXT || trimmed === "擲骰") return true;
  return DICE_SYMBOLS.includes(trimmed as (typeof DICE_SYMBOLS)[number]);
}

export interface SibalaRoll {
  dice: Dice;
  kind: "quad" | "points" | "none";
  /** Sum of the two non-paired dice (3..12) when kind === "points", else null. */
  points: number | null;
  /** The paired die face (1..6) for "points", or the quad face (1..6) for "quad", else null. */
  pair: Die | null;
  /** Numeric strength for comparing valid rolls: 0 for "none", 3..12 for "points", 101..106 for "quad". */
  rank: number;
  label: string;
}

export type DieRole = "pair" | "point" | "quad" | "none" | "plain";

export function getDieRoles(roll: SibalaRoll): DieRole[] {
  if (roll.kind === "quad") {
    return ["quad", "quad", "quad", "quad"];
  }
  if (roll.kind === "none") {
    return ["none", "none", "none", "none"];
  }
  let pairCount = 0;
  return roll.dice.map((d) => {
    if (d === roll.pair && pairCount < 2) {
      pairCount++;
      return "pair";
    }
    return "point";
  });
}

export function evaluateDice(dice: Dice): SibalaRoll {
  const [a, b, c, d] = [...dice].sort((x, y) => x - y) as Dice;

  // Four of a kind (一色 / 豹子)
  if (a === d) {
    return {
      dice: [...dice] as Dice,
      kind: "quad",
      points: null,
      pair: a,
      rank: 100 + a,
      label: `${DIE_SYMBOL[a]} 一色`,
    };
  }

  // Three of a kind or four distinct faces -> 無點 (must re-roll)
  if (a === c || b === d || (a !== b && b !== c && c !== d)) {
    return {
      dice: [...dice] as Dice,
      kind: "none",
      points: null,
      pair: null,
      rank: 0,
      label: "無點",
    };
  }

  // Either two pairs (a === b && c === d, with a < c -> pair is a, points = c + d)
  // or one pair (a === b -> c + d; b === c -> a + d; c === d -> a + b)
  let pair: Die;
  let points: number;
  if (a === b) {
    pair = a;
    points = c + d;
  } else if (b === c) {
    pair = b;
    points = a + d;
  } else {
    pair = c;
    points = a + b;
  }

  const label = points === 12 ? "十八（12 點）" : points === 3 ? "BG（3 點）" : `${points} 點`;
  return {
    dice: [...dice] as Dice,
    kind: "points",
    points,
    pair,
    rank: points,
    label,
  };
}

export function judgeSibala(
  players: string[],
  rolls: Record<string, SibalaRoll | null | undefined>,
): { winners: string[]; draw: boolean } {
  const valid = players.filter((p) => (rolls[p]?.rank ?? 0) > 0);
  if (valid.length === 0) return { winners: [], draw: true };
  const maxRank = Math.max(...valid.map((p) => rolls[p]!.rank));
  const top = valid.filter((p) => rolls[p]!.rank === maxRank);
  if (top.length === players.length) return { winners: [], draw: true };
  return { winners: top, draw: false };
}

export interface SibalaView {
  kind: "sibala";
  players: string[];
  rolls: Record<string, SibalaRoll | null>;
  turn: number;
  roller: string | null;
  winners: string[];
  draw: boolean;
}

export type SibalaEvent =
  | { game: "sibala"; event: "turn"; turn: number; roller: string }
  | { game: "sibala"; event: "rolled"; userId: string; roll: SibalaRoll }
  | { game: "sibala"; event: "ended"; winners: string[]; draw: boolean };

export type SibalaMessage =
  | { type: "started"; players: string[]; names: Record<string, string> }
  | { type: "rolled"; userId: string; name: string; roll: SibalaRoll; auto: boolean }
  | {
      type: "result";
      rolls: Record<string, SibalaRoll | null>;
      winners: string[];
      draw: boolean;
      names: Record<string, string>;
    };

export function sibalaView(view: SessionView): SibalaView | null {
  return view.game?.kind === "sibala" ? (view.game as SibalaView) : null;
}

export const sibala: SharedGame<SibalaView, SibalaEvent> = {
  id: "sibala",
  minPlayers: 2,
  applyEvent(game, event) {
    switch (event.event) {
      case "turn":
        game.turn = event.turn;
        game.roller = event.roller;
        break;
      case "rolled":
        game.rolls[event.userId] = event.roll;
        break;
      case "ended":
        game.roller = null;
        game.winners = event.winners;
        game.draw = event.draw;
        break;
    }
  },
};
