import type { GameEvent, GameView, MessageSecret } from "../shared/game";
import type { Action, Requirement } from "../shared/protocol";
import type { EventSecret } from "./store";

export interface PhaseOptions {
  durationMs?: number;
  requirement?: Omit<Requirement, "done">;
}

/** What a game may do to the session while handling a transition. Everything is synchronous. */
export interface GameContext<E extends GameEvent = GameEvent, M = unknown> {
  readonly now: number;
  readonly sessionId: string;
  /**
   * Emit a game event, delivered to every viewer as a `game_event`.
   * Private fields go in `secrets` (one entry per audience), never in `event` itself.
   */
  emit(event: E, secrets?: EventSecret[]): void;
  /** Append a game message to the room's text history. `secret` is shown only to `secret.to`. */
  post(data: M, secret?: MessageSecret): void;
  nameOf(userId: string): string;
  setPhase(name: string, options?: PhaseOptions): void;
  /** Players still holding a seat (role player, not left). */
  activePlayers(): string[];
  finish(): void;
}

/**
 * Server half of a game. Register it in `src/games/registry.server.ts`.
 * `S` is the game's private state, stored inside the session state as JSON.
 */
export interface GameModule<S = unknown, E extends GameEvent = GameEvent, M = unknown> {
  create(players: string[]): S;
  /** Enter the first phase. Called right after the initial `game_set` event. */
  begin(ctx: GameContext<E, M>, state: S): void;
  /**
   * Called only when the action matches the current phase requirement and the actor has not yet acted.
   * Returns an error code, or null on success. Must not emit anything when returning an error.
   */
  onAction(ctx: GameContext<E, M>, state: S, userId: string, action: Action): string | null;
  /**
   * The current phase ended: every actor is done, its deadline passed, or the last pending
   * actor left (so the requirement may be satisfied without that actor having acted).
   */
  onPhaseEnd(ctx: GameContext<E, M>, state: S, phaseName: string): void;
  /** The game view for `viewerId` (null = public). Must equal the result of replaying events. */
  project(state: S, viewerId: string | null): GameView;
  /** Valid action for a virtual participant (`bot-*`) when the current phase is waiting on `userId`. */
  botAction?(state: S, userId: string): Action | null;
}
