/** Client game registry. Must list exactly the games in `registry.ts`. */
import type { ClientGame } from "../client/game";
import { oldMaidClient } from "./oldmaid/client";
import type { GameId } from "./registry";
import { rpsClient } from "./rps/client";

export const CLIENT_GAMES: Record<GameId, ClientGame> = {
  rps: rpsClient,
  oldmaid: oldMaidClient,
};
