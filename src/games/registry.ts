/**
 * Shared game registry: the single list of game ids. Adding a game means adding it here,
 * in `registry.server.ts`, and in `registry.client.ts`; the core never names a game.
 */
import type { SharedGame } from "../shared/game";
import { oldMaid } from "./oldmaid/shared";
import { rps } from "./rps/shared";
import { sibala } from "./sibala/shared";

export const SHARED_GAMES = {
  rps,
  oldmaid: oldMaid,
  sibala,
} satisfies Record<string, SharedGame<never, never>>;

export type GameId = keyof typeof SHARED_GAMES;

/** Every room mode: free text, then each registered game. */
export const GAME_MODES = ["text", ...(Object.keys(SHARED_GAMES) as GameId[])] as const;

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && Object.hasOwn(SHARED_GAMES, value);
}

export function isGameMode(value: unknown): value is "text" | GameId {
  return value === "text" || isGameId(value);
}
