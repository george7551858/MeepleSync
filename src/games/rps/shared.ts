import type { SharedGame } from "../../shared/game";
import type { SessionView } from "../../shared/protocol";

export const HANDS = ["rock", "paper", "scissors"] as const;
export type Hand = (typeof HANDS)[number];

export const BEATS: Record<Hand, Hand> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper",
};

/** The only texts a player may submit while choosing. */
export const HAND_TEXT: Record<Hand, string> = { rock: "石頭", paper: "布", scissors: "剪刀" };

export function parseHand(text: unknown): Hand | null {
  if (typeof text !== "string") return null;
  return HANDS.find((h) => HAND_TEXT[h] === text.trim()) ?? null;
}

export interface RpsPick {
  choice: Hand;
  nonce: string;
}

export interface RpsRoundResult {
  round: number;
  /** null = the player did not choose before the deadline. */
  picks: Record<string, RpsPick | null>;
  commitments: Record<string, string>;
  winners: string[];
  draw: boolean;
}

export interface RpsView {
  kind: "rps";
  totalRounds: number;
  round: number;
  players: string[];
  scores: Record<string, number>;
}

export type RpsEvent =
  | { game: "rps"; event: "round_started"; round: number }
  | { game: "rps"; event: "revealed"; scores: Record<string, number> };

/** `data` of the game messages rps posts into the text history. */
export type RpsMessage =
  /** A hidden pick. The chosen text is in the message secret, visible only to its author. */
  | { type: "commit"; userId: string; name: string; commitment: string }
  | {
      type: "result";
      result: RpsRoundResult;
      names: Record<string, string>;
      scores: Record<string, number>;
      final: boolean;
    };

export interface RpsCommitSecret {
  text: string;
}

export function rpsView(view: SessionView): RpsView | null {
  return view.game?.kind === "rps" ? (view.game as RpsView) : null;
}

/**
 * Players who did not choose lose the round. Among those who chose:
 * all three hands or a single hand from everyone is a draw.
 */
export function judge(
  players: string[],
  choices: Record<string, Hand | undefined>,
): { winners: string[]; draw: boolean } {
  const submitted = players.filter((p) => choices[p]);
  if (submitted.length === 0) return { winners: [], draw: true };
  const kinds = [...new Set(submitted.map((p) => choices[p]!))];
  if (kinds.length === 3) return { winners: [], draw: true };
  if (kinds.length === 1) {
    if (submitted.length === players.length) return { winners: [], draw: true };
    return { winners: submitted, draw: false };
  }
  const [a, b] = kinds;
  const winning = BEATS[a] === b ? a : b;
  return { winners: submitted.filter((p) => choices[p] === winning), draw: false };
}

export function commitmentInput(
  sessionId: string,
  round: number,
  userId: string,
  choice: Hand,
  nonce: string,
): string {
  return `${sessionId}|${round}|${userId}|${choice}|${nonce}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCommitment(
  sessionId: string,
  round: number,
  userId: string,
  pick: RpsPick,
  commitment: string,
): Promise<boolean> {
  return (await sha256Hex(commitmentInput(sessionId, round, userId, pick.choice, pick.nonce))) === commitment;
}

export const rps: SharedGame<RpsView, RpsEvent> = {
  id: "rps",
  minPlayers: 2,
  applyEvent(game, event) {
    switch (event.event) {
      case "round_started":
        game.round = event.round;
        break;
      case "revealed":
        game.scores = event.scores;
        break;
    }
  },
};
