# AGENTS.md

Notes for anyone (human or agent) changing this repo. Read `README.md` first for what the app does. This file lists the invariants that keep realtime sync correct, plus the traps we already fell into.

## Commands

- `npm test`: Vitest in the Workers runtime. Must pass before every commit.
- `npm run typecheck`: `tsc -b`. Must pass before every commit.
- `npm run build`: catches bundling problems the typecheck misses.
- `npm run cf-typegen`: run after any change to `wrangler.jsonc`.

## Product direction

- **Text is the primitive.** Every room has one shared text history and one input box.
  - Games are special cases of text: a game restricts which texts are accepted from whom and when, may hide them behind a commitment, and posts its results back into the history.
  - Do not add separate move buttons, actions, or panels that bypass the text input. Quick-input buttons must send the same text the user could type.
- **Keep the UI minimal.**
  - UI strings are Traditional Chinese.
  - Server error codes are English `snake_case`, mapped to Chinese in `src/client/labels.ts`.
- **Mode is per room**: `text` or `rps`. The host can change it in the lobby only.

## Architecture invariants (do not break)

1. **The server is the only authority.** The client never mutates its view directly. It only applies a server snapshot, then server events through `applyEvent()` in `src/shared/view.ts`.

2. **Snapshot equals replay.** For any viewer, these two must be deep-equal:
   - an older snapshot with the later events applied through `applyEvent()`
   - a fresh `snapshot()` taken now

   Whenever you add state or an event, update all three of these together:
   - the server mutation in `session.ts` or the game module
   - the reducer in `view.ts` (or `applyRpsEvent`)
   - the snapshot projection (`snapshot()` / `GameModule.project`)

   The tests check this by comparing the live view with `syncFresh()`. Add the same comparison for new features.

3. **`seq` is contiguous for every viewer.** Every event goes to every authenticated socket.
   - Hide private data by redacting it, never by dropping the event.
   - Put private fields in the event's `secret` (`{ to, data }`), or use `projectMessage` for messages. Never put them in the public `data`.
   - A skipped `seq` makes clients resync forever.

4. **Private data needs the same projection on both paths.** Anything hidden in events must also be hidden in `snapshot(viewerId)` and in replayed events (`sendSync`). Write a test that checks the serialized messages other viewers receive do not contain the secret.

5. **State transitions must be synchronous.** Do not `await` between reading and writing state inside a Durable Object handler; other messages can interleave at an `await`.
   - The SQLite API (`ctx.storage.sql`) is synchronous.
   - Hash with `node:crypto` (`createHash`), not `crypto.subtle`, because the latter is async.
   - `nodejs_compat` is enabled for this.

6. **Every mutation goes through a `Tx`.**
   - `emit()` appends to the log and bumps `seq`.
   - `commit()` saves state, prunes the logs, reschedules the alarm, and broadcasts.
   - Return error codes before emitting anything. A game's `onAction` must not emit when it returns an error.

7. **Validation order for actions**: identity, then role, then host-only, then `phaseId` (`stale_phase`), then deadline, then the requirement actor, then game rules.
   - Free text from someone the phase is *not* waiting on skips the phase checks on purpose, so chat never fails with `stale_phase`.
   - Text from a pending actor is their move, so it *is* phase-checked. This stops an old chat line from being counted as this round's move.

8. **Idempotency**: actions are cached by `actionId`. The client resends pending actions after reconnecting, so any new action must be safe to retry with the same id.

## Known pitfalls

### Durable Object and alarm

- **`ctx.getWebSockets()` still includes sockets that are closing.** Use `hasLiveSocket()`, which checks `readyState === WebSocket.OPEN`, when deciding whether a room is idle.
- **Every socket close must reschedule the alarm**, even when no presence event is emitted. Missing this once meant the last person leaving never scheduled idle cleanup, so the room was never deleted.
- **There is no schema migration for `SessionState`.** It is stored as one JSON blob, and adding a required field breaks rooms created earlier. This already happened: rooms without `mode` or `messages`, and messages without `kind`, crashed after an update.
  - Either default missing fields in `Store.loadState()`, or make the new fields optional.
  - Once real users exist, this is mandatory.
- **`runDurableObjectAlarm()` in tests fires the alarm immediately**, but the handler still compares against real deadlines. Tests therefore move deadlines or `disconnectedAt` into the past with `runInDurableObject` first (see `expireAndRunAlarm` in `test/session.test.ts`).

### Browser

- **Secure-context-only APIs.**
  - `crypto.randomUUID()` and `crypto.subtle` do not exist on plain-HTTP non-localhost origins. Using `randomUUID` blanked the whole page when someone opened the app over a LAN IP.
  - Generate ids on the client with `randomHex()` from `src/client/identity.ts`.
  - `crypto.subtle` is only used to verify commitments, which is why the dev server runs over HTTPS (`@vitejs/plugin-basic-ssl`). Keep that plugin.
- **Identity is shared across tabs** through `localStorage`. A second tab replaces the first (close code `4001`). That is intended behavior, not a bug. To test several users, use different origins (`localhost` and `127.0.0.1`), browsers, or private windows.

### Toolchain

- **npm 11 blocks install scripts.** `workerd` and `esbuild` must be listed in `package.json` `allowScripts`. After bumping `wrangler`, `@cloudflare/vite-plugin`, or `@cloudflare/vitest-pool-workers`, run `npm approve-scripts workerd esbuild`; otherwise the runtime binary is missing.
- **Version pins that matter:**
  - `@cloudflare/vitest-pool-workers` 0.22 requires `vitest` 4.1.x. Do not upgrade to Vitest 5 until the pool supports it.
  - Tests are configured through the `cloudflareTest()` Vite plugin in `vitest.config.ts`.
  - Tests import `env` and `exports` from `cloudflare:workers`; the old `SELF` is deprecated.
  - `compatibility_date` in `wrangler.jsonc` must not be newer than the `workerd` bundled with the Vitest pool, which supports up to about 2026-08-15. Otherwise tests fail to start.
  - TypeScript is pinned to 5.9.
- **Always generate types with `npm run cf-typegen`**, which passes `--strict-vars=false`. Without that flag, `vars` such as `DEBUG` become literal types like `"0"`, and `env.DEBUG === "1"` stops compiling.
- **Sandboxed shells:** `wrangler`, `vite`, and `vitest` spawn and kill `workerd`. Inside a restricted sandbox they fail with `kill EACCES`, so run them with full permissions.

### Browser automation

- **Element refs can be reused after navigation.** A retried click once hit the "離開" (leave) button, which had taken the old "建立新房間" button's ref, and made the user leave the room. Take a fresh snapshot after every navigation.
- **Synthetic Enter key events do not submit forms.** Click the submit button instead.
- **Deadlines keep running while you automate.** Choosing takes 20 s, and slow tool calls can let a round time out. Account for this, or lower the constants locally.

## Adding a new game

1. Add a mode to `GameMode` / `GAME_MODES` in `src/shared/protocol.ts`, plus a label in `MODE_LABEL`.
2. Put shared rules and types in `src/shared/games/<game>.ts`. Add its events to `EventBody` and handle them in `applyEvent`.
3. Implement `GameModule` in `src/worker/games/<game>.ts` and register it in `GAMES` in `session.ts`.
   - Moves are `text.post` with a phase `requirement` whose `actionType` is `"text.post"`.
   - Validate the text in `onAction`.
   - Publish results to the history with `ctx.post()`.
4. Hidden submissions use a `commit` message. The server hashes `commitmentInput(...)` with `node:crypto`, and the client verifies the hash after the reveal.
5. Write tests:
   - the full game flow
   - timeouts
   - observers cannot act
   - hidden data is absent from other viewers' messages and snapshots
   - live view equals `syncFresh()`

## Commits

Use an imperative subject line, then a short body that explains why. Commit only when asked.
