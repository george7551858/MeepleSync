export const HANDS = ["rock", "paper", "scissors"] as const;
export type Hand = (typeof HANDS)[number];

export const BEATS: Record<Hand, Hand> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper",
};

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
  /** Public commitment hashes of the current round. */
  commitments: Record<string, string>;
  /** The viewer's own choice in the current round (private). */
  myChoice: Hand | null;
  history: RpsRoundResult[];
}

export type RpsEventBody =
  | { type: "rps_round_started"; data: { round: number } }
  | { type: "rps_committed"; data: { userId: string; commitment: string; choice?: Hand } }
  | { type: "rps_revealed"; data: { result: RpsRoundResult; scores: Record<string, number> } };

export function isHand(value: unknown): value is Hand {
  return typeof value === "string" && (HANDS as readonly string[]).includes(value);
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

export function applyRpsEvent(game: RpsView, event: RpsEventBody): void {
  switch (event.type) {
    case "rps_round_started":
      game.round = event.data.round;
      game.commitments = {};
      game.myChoice = null;
      break;
    case "rps_committed":
      game.commitments[event.data.userId] = event.data.commitment;
      if (event.data.choice) game.myChoice = event.data.choice;
      break;
    case "rps_revealed":
      game.history.push(event.data.result);
      game.scores = event.data.scores;
      break;
  }
}
