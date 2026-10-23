import type { SharedGame } from "../../shared/game";
import type { SessionView } from "../../shared/protocol";

/**
 * Old Maid (抽鬼牌): 52 cards plus one joker are dealt to everyone, and each player throws away
 * pairs of the same rank. On your turn you draw one face-down card from the next player who still
 * holds cards, by typing its position (1 = leftmost). Players who run out of cards are safe;
 * whoever is left holding the joker loses.
 */

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const JOKER = "JK";
/** `<rank><suit>` such as `10H` or `AS`, or `JK` for the joker. */
export type Card = string;

export const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function fullDeck(): Card[] {
  return [...RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`)), JOKER];
}

export function rankOf(card: Card): string {
  return card === JOKER ? JOKER : card.slice(0, -1);
}

export function suitOf(card: Card): string {
  return card === JOKER ? "" : card.slice(-1);
}

function cardOrder(card: Card): number {
  if (card === JOKER) return 1000;
  return RANKS.indexOf(rankOf(card) as (typeof RANKS)[number]) * 10 + SUITS.indexOf(suitOf(card) as (typeof SUITS)[number]);
}

/** The order a player sees their own hand in. The server keeps the face-down order separately. */
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => cardOrder(a) - cardOrder(b));
}

export function cardLabel(card: Card): string {
  return card === JOKER ? "🃏鬼牌" : `${SUIT_SYMBOL[suitOf(card)]}${rankOf(card)}`;
}

/** Parses a 1-based card position, accepting full-width digits. Returns null when out of range. */
export function parseDrawIndex(text: unknown, handSize: number): number | null {
  if (typeof text !== "string") return null;
  const normalized = text.trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!/^\d{1,3}$/.test(normalized)) return null;
  const index = Number(normalized);
  return index >= 1 && index <= handSize ? index : null;
}

export interface OldMaidView {
  kind: "oldmaid";
  /** Seat order; each player draws from the next player who still holds cards. */
  players: string[];
  counts: Record<string, number>;
  /** The viewer's own hand, sorted. null for viewers who are not in the game. */
  myHand: Card[] | null;
  turn: number;
  drawer: string | null;
  target: string | null;
  /** Players who emptied their hand, in the order they did. */
  out: string[];
  loser: string | null;
}

/** `hand` is never public: it only reaches its owner through the event's secret. */
export type OldMaidEvent =
  | { game: "oldmaid"; event: "dealt"; counts: Record<string, number>; hand?: Card[] }
  | { game: "oldmaid"; event: "turn"; turn: number; drawer: string; target: string }
  | { game: "oldmaid"; event: "drew"; counts: Record<string, number>; out: string[]; hand?: Card[] }
  | { game: "oldmaid"; event: "ended"; loser: string | null };

/** `data` of the game messages Old Maid posts into the text history. */
export type OldMaidMessage =
  | { type: "dealt"; names: Record<string, string>; pairs: Record<string, number>; counts: Record<string, number> }
  | {
      type: "drew";
      drawer: string;
      target: string;
      /** 1-based position drawn from the target's face-down hand. */
      index: number;
      /** The pair the drawer threw away, if the drawn card made one. Discards are face up. */
      pair: Card[] | null;
      /** Players whose hand became empty with this draw. */
      out: string[];
      /** Drawn by the server because the drawer timed out or left. */
      auto: boolean;
      names: Record<string, string>;
    }
  | { type: "result"; loser: string | null; out: string[]; names: Record<string, string> };

/** Secret of a `drew` message, visible to the drawer and the player drawn from. */
export interface OldMaidDrewSecret {
  card: Card;
}

export function oldMaidView(view: SessionView): OldMaidView | null {
  return view.game?.kind === "oldmaid" ? (view.game as OldMaidView) : null;
}

export const oldMaid: SharedGame<OldMaidView, OldMaidEvent> = {
  id: "oldmaid",
  minPlayers: 2,
  applyEvent(game, event) {
    switch (event.event) {
      case "dealt":
        game.counts = event.counts;
        if (event.hand) game.myHand = event.hand;
        break;
      case "turn":
        game.turn = event.turn;
        game.drawer = event.drawer;
        game.target = event.target;
        break;
      case "drew":
        game.counts = event.counts;
        game.out = event.out;
        if (event.hand) game.myHand = event.hand;
        break;
      case "ended":
        game.loser = event.loser;
        game.drawer = null;
        game.target = null;
        break;
    }
  },
};
