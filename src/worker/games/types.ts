import type { Action, EventBody, GameView, Requirement } from "../../shared/protocol";
import type { EventSecret } from "../store";

export interface PhaseOptions {
  durationMs?: number;
  requirement?: Omit<Requirement, "done">;
}

/** What a game may do to the session while handling a transition. */
export interface GameContext {
  readonly now: number;
  readonly sessionId: string;
  emit(body: EventBody, secret?: EventSecret): void;
  setPhase(name: string, options?: PhaseOptions): void;
  /** Players still holding a seat (role player, not left). */
  activePlayers(): string[];
  finish(): void;
}

export interface GameModule<S = unknown> {
  kind: string;
  minPlayers: number;
  create(players: string[], options: { rounds?: number }): S;
  /** Enter the first phase. Called right after the initial `game_set` event. */
  begin(ctx: GameContext, state: S): void;
  /**
   * Called only when the action matches the current phase requirement and the actor has not yet acted.
   * Returns an error code, or null on success. Must not emit anything when returning an error.
   */
  onAction(ctx: GameContext, state: S, userId: string, action: Action): string | null;
  /** The current phase ended, either because every actor is done or its deadline passed. */
  onPhaseEnd(ctx: GameContext, state: S, phaseName: string): void;
  project(state: S, viewerId: string | null): GameView;
}
