/** Server game registry. Must list exactly the games in `registry.ts`. */
import type { GameModule } from "../worker/game";
import { oldMaidServer } from "./oldmaid/server";
import type { GameId } from "./registry";
import { rpsServer } from "./rps/server";

export const SERVER_GAMES: Record<GameId, GameModule<any, any, any>> = {
  rps: rpsServer,
  oldmaid: oldMaidServer,
};
