import { randomInt } from "node:crypto";
import type { GameContext, GameModule } from "../../worker/game";
import {
  JOKER,
  fullDeck,
  parseDrawIndex,
  rankOf,
  type Card,
  type OldMaidEvent,
  type OldMaidMessage,
  type OldMaidView,
} from "./shared";

export const DRAW_MS = 30_000;

/** Drawing is typing a card position into the room's text input. */
export const DRAW_ACTION = "text.post";

export interface OldMaidState {
  players: string[];
  /** Each player's hand in its 1..N order (the same order the owner sees on screen). */
  hands: Record<string, Card[]>;
  out: string[];
  turn: number;
  drawer: string | null;
  target: string | null;
  /** Whether the current drawer already drew this turn. */
  drawn: boolean;
  loser: string | null;
}

type Ctx = GameContext<OldMaidEvent, OldMaidMessage>;

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Removes every pair of the same rank (the joker never pairs). Returns the pairs removed. */
export function discardPairs(hand: Card[]): { kept: Card[]; pairs: Card[][] } {
  const kept: Card[] = [];
  const pairs: Card[][] = [];
  const waiting = new Map<string, Card>();
  for (const card of hand) {
    const rank = rankOf(card);
    const partner = waiting.get(rank);
    if (card !== JOKER && partner) {
      pairs.push([partner, card]);
      waiting.delete(rank);
    } else {
      waiting.set(rank, card);
    }
  }
  for (const card of hand) if (waiting.get(rankOf(card)) === card) kept.push(card);
  return { kept, pairs };
}

function counts(s: OldMaidState): Record<string, number> {
  return Object.fromEntries(s.players.map((p) => [p, s.hands[p].length]));
}

function holders(s: OldMaidState): string[] {
  return s.players.filter((p) => s.hands[p].length > 0);
}

/** The next player after `seat` (in seat order, wrapping) who still holds cards, other than `seat` itself. */
function nextHolder(s: OldMaidState, seat: string): string | null {
  const n = s.players.length;
  const start = s.players.indexOf(seat);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(start + k) % n];
    if (p !== seat && s.hands[p].length > 0) return p;
  }
  return null;
}

function namesOf(ctx: Ctx, ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, ctx.nameOf(id)]));
}

function draw(ctx: Ctx, s: OldMaidState, position: number, auto: boolean): void {
  const drawer = s.drawer!;
  const target = s.target!;
  const [card] = s.hands[target].splice(position, 1);
  const hand = s.hands[drawer];
  const match = card === JOKER ? -1 : hand.findIndex((c) => rankOf(c) === rankOf(card));
  let pair: Card[] | null = null;
  if (match >= 0) {
    pair = [hand[match], card];
    hand.splice(match, 1);
  } else {
    hand.splice(randomInt(hand.length + 1), 0, card);
  }
  s.drawn = true;
  const newlyOut = [target, drawer].filter((p) => s.hands[p].length === 0 && !s.out.includes(p));
  s.out.push(...newlyOut);

  ctx.emit({ game: "oldmaid", event: "drew", counts: counts(s), out: [...s.out] }, [
    { to: [drawer], data: { hand: [...s.hands[drawer]] } },
    { to: [target], data: { hand: [...s.hands[target]] } },
  ]);
  ctx.post(
    { type: "drew", drawer, target, index: position + 1, pair, out: newlyOut, auto, names: namesOf(ctx, [drawer, target]) },
    { to: [drawer, target], data: { card } },
  );
}

function end(ctx: Ctx, s: OldMaidState): void {
  const remaining = holders(s);
  s.loser = remaining.find((p) => s.hands[p].includes(JOKER)) ?? remaining[0] ?? null;
  s.drawer = null;
  s.target = null;
  ctx.emit({ game: "oldmaid", event: "ended", loser: s.loser });
  ctx.post({ type: "result", loser: s.loser, out: [...s.out], names: namesOf(ctx, s.players) });
  ctx.finish();
}

/**
 * Starts the turn after `previous` drew. Players who left are drawn for immediately.
 * Ends the game when one player holds cards, or when nobody still at the table does.
 */
function nextTurn(ctx: Ctx, s: OldMaidState, previous: string): void {
  for (let guard = 0; guard <= s.players.length * 2; guard++) {
    const active = new Set(ctx.activePlayers());
    const left = holders(s);
    if (left.length <= 1 || !left.some((p) => active.has(p))) break;
    const drawer = nextHolder(s, previous)!;
    const target = nextHolder(s, drawer)!;
    s.turn += 1;
    s.drawer = drawer;
    s.target = target;
    s.drawn = false;
    ctx.emit({ game: "oldmaid", event: "turn", turn: s.turn, drawer, target });
    if (active.has(drawer)) {
      ctx.setPhase("drawing", { durationMs: DRAW_MS, requirement: { actionType: DRAW_ACTION, actors: [drawer] } });
      return;
    }
    draw(ctx, s, randomInt(s.hands[target].length), true);
    previous = drawer;
  }
  end(ctx, s);
}

export const oldMaidServer: GameModule<OldMaidState, OldMaidEvent, OldMaidMessage> = {
  create(players) {
    return {
      players,
      hands: Object.fromEntries(players.map((p) => [p, []])),
      out: [],
      turn: 0,
      drawer: null,
      target: null,
      drawn: false,
      loser: null,
    };
  },

  begin(ctx, s) {
    const deck = shuffle(fullDeck());
    deck.forEach((card, i) => s.hands[s.players[i % s.players.length]].push(card));
    const pairs: Record<string, number> = {};
    for (const p of s.players) {
      const result = discardPairs(s.hands[p]);
      s.hands[p] = shuffle(result.kept);
      pairs[p] = result.pairs.length;
    }
    s.out = s.players.filter((p) => s.hands[p].length === 0);

    ctx.emit(
      { game: "oldmaid", event: "dealt", counts: counts(s), out: [...s.out] },
      s.players.map((p) => ({ to: [p], data: { hand: [...s.hands[p]] } })),
    );
    ctx.post({ type: "dealt", names: namesOf(ctx, s.players), pairs, counts: counts(s) });
    // The first player in seat order draws first.
    nextTurn(ctx, s, s.players[s.players.length - 1]);
  },

  onAction(ctx, s, userId, action) {
    if (action.type !== DRAW_ACTION) return "unknown_action";
    if (s.drawn || userId !== s.drawer || !s.target) return "not_your_turn";
    const index = parseDrawIndex(action.text, s.hands[s.target].length);
    if (index === null) return "invalid_draw";
    draw(ctx, s, index - 1, false);
    return null;
  },

  onPhaseEnd(ctx, s, phaseName) {
    if (phaseName !== "drawing" || !s.drawer || !s.target) return;
    // Timed out, or the drawer left: draw a random card for them.
    if (!s.drawn) draw(ctx, s, randomInt(s.hands[s.target].length), true);
    nextTurn(ctx, s, s.drawer);
  },

  project(s, viewerId): OldMaidView {
    return {
      kind: "oldmaid",
      players: [...s.players],
      counts: counts(s),
      myHand: viewerId !== null && s.hands[viewerId] ? [...s.hands[viewerId]] : null,
      turn: s.turn,
      drawer: s.drawer,
      target: s.target,
      out: [...s.out],
      loser: s.loser,
    };
  },
};
