/**
 * Core contract every game implements on the shared (worker + client) side.
 * Game code lives in `src/games/<id>/`; the core only talks to games through these types
 * and the registries in `src/games/registry*.ts`.
 */

/** A game's public view. `kind` is the game id; the rest is game-defined. */
export interface GameView {
  kind: string;
}

/** Payload of a `game_event` session event. `game` is the game id, `event` the game's own event name. */
export interface GameEvent {
  game: string;
  event: string;
}

/** Private part of a message, kept only for the listed viewers. */
export interface MessageSecret {
  to: string[];
  data: unknown;
}

export interface SharedGame<V extends GameView = GameView, E extends GameEvent = GameEvent> {
  id: string;
  minPlayers: number;
  /**
   * Apply one of this game's events to its view, in place. Together with the server's
   * `project()`, this must keep "snapshot equals replay" true for every viewer.
   */
  applyEvent(view: V, event: E): void;
}
