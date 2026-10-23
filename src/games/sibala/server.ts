import { randomInt } from "node:crypto";
import type { GameContext, GameModule } from "../../worker/game";
import {
  DICE_FACES,
  evaluateDice,
  isRollText,
  judgeSibala,
  type Dice,
  type Die,
  type SibalaEvent,
  type SibalaMessage,
  type SibalaRoll,
  type SibalaView,
} from "./shared";

export const ROLL_MS = 20_000;
export const ROLL_ACTION = "text.post";
/** Cap consecutive 無點 rolls per player so a turn always terminates in a bounded number of steps. */
export const MAX_ATTEMPTS = 5;

export interface SibalaState {
  players: string[];
  rolls: Record<string, SibalaRoll | null>;
  attempts: Record<string, number>;
  turn: number;
  roller: string | null;
  rolled: boolean;
  winners: string[];
  draw: boolean;
}

type Ctx = GameContext<SibalaEvent, SibalaMessage>;

function randomDie(): Die {
  return DICE_FACES[randomInt(DICE_FACES.length)];
}

export function randomDice(): Dice {
  return [randomDie(), randomDie(), randomDie(), randomDie()];
}

export function randomValidRoll(): SibalaRoll {
  for (let i = 0; i < 64; i++) {
    const roll = evaluateDice(randomDice());
    if (roll.kind !== "none") return roll;
  }
  const pair = randomDie();
  let d3 = randomDie();
  let d4 = randomDie();
  if (d3 === d4 && d3 === pair) d4 = ((pair % 6) + 1) as Die;
  return evaluateDice([pair, pair, d3, d4]);
}

function namesOf(ctx: Ctx, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, ctx.nameOf(id)]));
}

function hasValidRoll(s: SibalaState, userId: string): boolean {
  const r = s.rolls[userId];
  return r !== null && r !== undefined && r.kind !== "none";
}

function nextPendingPlayer(s: SibalaState): string | null {
  return s.players.find((p) => !hasValidRoll(s, p)) ?? null;
}

function recordRoll(ctx: Ctx, s: SibalaState, userId: string, roll: SibalaRoll, auto: boolean): void {
  s.rolls[userId] = roll;
  s.rolled = true;
  ctx.emit({ game: "sibala", event: "rolled", userId, roll });
  ctx.post({ type: "rolled", userId, name: ctx.nameOf(userId), roll, auto });
}

function end(ctx: Ctx, s: SibalaState): void {
  const { winners, draw } = judgeSibala(s.players, s.rolls);
  s.roller = null;
  s.winners = winners;
  s.draw = draw;
  ctx.emit({ game: "sibala", event: "ended", winners, draw });
  ctx.post({
    type: "result",
    rolls: Object.fromEntries(s.players.map((p) => [p, s.rolls[p] ? structuredClone(s.rolls[p]) : null])),
    winners,
    draw,
    names: namesOf(ctx, s.players),
  });
  ctx.finish();
}

function nextTurn(ctx: Ctx, s: SibalaState): void {
  const active = new Set(ctx.activePlayers());
  for (let guard = 0; guard <= s.players.length * (MAX_ATTEMPTS + 1); guard++) {
    const roller = nextPendingPlayer(s);
    if (!roller) break;
    s.turn += 1;
    s.roller = roller;
    s.rolled = false;
    ctx.emit({ game: "sibala", event: "turn", turn: s.turn, roller });
    if (active.has(roller)) {
      ctx.setPhase("rolling", {
        durationMs: ROLL_MS,
        requirement: { actionType: ROLL_ACTION, actors: [roller] },
      });
      return;
    }
    recordRoll(ctx, s, roller, randomValidRoll(), true);
  }
  end(ctx, s);
}

export const sibalaServer: GameModule<SibalaState, SibalaEvent, SibalaMessage> = {
  create(players) {
    return {
      players,
      rolls: Object.fromEntries(players.map((p) => [p, null])),
      attempts: Object.fromEntries(players.map((p) => [p, 0])),
      turn: 0,
      roller: null,
      rolled: false,
      winners: [],
      draw: false,
    };
  },

  begin(ctx, s) {
    ctx.post({ type: "started", players: [...s.players], names: namesOf(ctx, s.players) });
    nextTurn(ctx, s);
  },

  onAction(ctx, s, userId, action) {
    if (action.type !== ROLL_ACTION) return "unknown_action";
    if (s.rolled || userId !== s.roller) return "not_your_turn";
    if (!isRollText(action.text)) return "invalid_roll";
    const attempt = (s.attempts[userId] ?? 0) + 1;
    s.attempts[userId] = attempt;
    const roll = attempt >= MAX_ATTEMPTS ? randomValidRoll() : evaluateDice(randomDice());
    recordRoll(ctx, s, userId, roll, false);
    return null;
  },

  onPhaseEnd(ctx, s, phaseName) {
    if (phaseName !== "rolling" || !s.roller) return;
    if (!s.rolled) {
      recordRoll(ctx, s, s.roller, randomValidRoll(), true);
    }
    nextTurn(ctx, s);
  },

  project(s): SibalaView {
    return {
      kind: "sibala",
      players: [...s.players],
      rolls: Object.fromEntries(s.players.map((p) => [p, s.rolls[p] ? structuredClone(s.rolls[p]) : null])),
      turn: s.turn,
      roller: s.roller,
      winners: [...s.winners],
      draw: s.draw,
    };
  },
};
