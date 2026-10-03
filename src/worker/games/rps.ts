import { createHash, randomBytes } from "node:crypto";
import {
  HAND_TEXT,
  commitmentInput,
  judge,
  parseHand,
  type Hand,
  type RpsRoundResult,
  type RpsView,
} from "../../shared/games/rps";
import { CHOOSE_MS, REVEAL_MS } from "../config";
import type { GameContext, GameModule } from "./types";

export interface RpsState {
  round: number;
  players: string[];
  picks: Record<string, { choice: Hand; nonce: string; commitment: string }>;
}

/** Choosing is typing one of the HAND_TEXT words into the room's text input. */
export const CHOOSE_ACTION = "text.post";

function startRound(ctx: GameContext, s: RpsState): void {
  s.round += 1;
  s.picks = {};
  ctx.emit({ type: "rps_round_started", data: { round: s.round } });
  const active = new Set(ctx.activePlayers());
  ctx.setPhase("choosing", {
    durationMs: CHOOSE_MS,
    requirement: { actionType: CHOOSE_ACTION, actors: s.players.filter((p) => active.has(p)) },
  });
}

function reveal(ctx: GameContext, s: RpsState): void {
  const choices = Object.fromEntries(Object.entries(s.picks).map(([id, p]) => [id, p.choice]));
  const { winners, draw } = judge(s.players, choices);
  const result: RpsRoundResult = {
    round: s.round,
    picks: Object.fromEntries(
      s.players.map((id) => [id, s.picks[id] ? { choice: s.picks[id].choice, nonce: s.picks[id].nonce } : null]),
    ),
    commitments: Object.fromEntries(Object.entries(s.picks).map(([id, p]) => [id, p.commitment])),
    winners,
    draw,
  };
  ctx.emit({ type: "rps_revealed", data: { scores: {} } });
  ctx.post({
    kind: "rps_result",
    result,
    names: Object.fromEntries(s.players.map((id) => [id, ctx.nameOf(id)])),
    scores: {},
    final: true,
  });
  ctx.setPhase("revealed", { durationMs: REVEAL_MS });
}

export const rps: GameModule<RpsState> = {
  kind: "rps",
  minPlayers: 2,

  create(players) {
    return {
      round: 0,
      players,
      picks: {},
    };
  },

  begin(ctx, s) {
    startRound(ctx, s);
  },

  onAction(ctx, s, userId, action) {
    if (action.type !== CHOOSE_ACTION) return "unknown_action";
    const choice = parseHand(action.text);
    if (!choice) return "invalid_choice";
    if (s.picks[userId]) return "already_committed";
    const nonce = randomBytes(16).toString("hex");
    const commitment = createHash("sha256")
      .update(commitmentInput(ctx.sessionId, s.round, userId, choice, nonce))
      .digest("hex");
    s.picks[userId] = { choice, nonce, commitment };
    ctx.post({ kind: "commit", userId, name: ctx.nameOf(userId), commitment, text: HAND_TEXT[choice] });
    return null;
  },

  onPhaseEnd(ctx, s, phaseName) {
    if (phaseName === "choosing") reveal(ctx, s);
    else if (phaseName === "revealed") ctx.finish();
  },

  project(s): RpsView {
    return {
      kind: "rps",
      totalRounds: 1,
      round: s.round,
      players: [...s.players],
      scores: {},
    };
  },
};
