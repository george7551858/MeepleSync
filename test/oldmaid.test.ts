import { describe, expect, it } from "vitest";
import { discardPairs } from "../src/games/oldmaid/server";
import {
  JOKER,
  fullDeck,
  oldMaidView,
  parseDrawIndex,
  rankOf,
  type OldMaidDrewSecret,
  type OldMaidMessage,
  type OldMaidView,
} from "../src/games/oldmaid/shared";
import { SHARED_GAMES } from "../src/games/registry";
import { SERVER_GAMES } from "../src/games/registry.server";
import { applyEvent } from "../src/shared/view";
import type { SessionEvent, TextMessage } from "../src/shared/protocol";
import { TestClient, createSession, expireAndRunAlarm, makeIdentity } from "./helpers";

type GameMsg = Extract<TextMessage, { kind: "game" }>;
type Data<T extends OldMaidMessage["type"]> = Extract<OldMaidMessage, { type: T }>;

function game(client: TestClient): OldMaidView {
  return oldMaidView(client.view!)!;
}

function oldMaidMessages(client: TestClient): GameMsg[] {
  return client.view!.messages.filter((m): m is GameMsg => m.kind === "game" && m.game === "oldmaid");
}

function messagesOfType<T extends OldMaidMessage["type"]>(client: TestClient, type: T) {
  return oldMaidMessages(client).filter((m) => (m.data as OldMaidMessage).type === type) as (GameMsg & {
    data: Data<T>;
  })[];
}

async function startGame(playerNames: string[], observers: string[] = []) {
  const sessionId = await createSession("oldmaid");
  const players: TestClient[] = [];
  for (const name of playerNames) {
    const c = await TestClient.connect(sessionId, makeIdentity(name));
    await c.ready();
    players.push(c);
  }
  const watchers: TestClient[] = [];
  for (const name of observers) {
    const c = await TestClient.connect(sessionId, makeIdentity(name), "observer");
    await c.ready();
    watchers.push(c);
  }
  const all = [...players, ...watchers];
  await players[0].waitFor(() => players[0].view!.participants.length === all.length);
  expect(await players[0].act({ type: "start" })).toMatchObject({ ok: true });
  for (const c of all) await c.waitFor(() => c.view!.status !== "lobby" && c.view!.game);
  return { sessionId, players, watchers, all };
}

/** Waits until every client has caught up with the first client's seq. */
async function settle(clients: TestClient[]) {
  const seq = Math.max(...clients.map((c) => c.view!.seq));
  for (const c of clients) await c.waitFor(() => c.view!.seq >= seq);
}

function byId(clients: TestClient[], userId: string | null) {
  return clients.find((c) => c.identity.userId === userId)!;
}

describe("old maid rules", () => {
  it("uses 52 cards plus one joker", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(53);
    expect(new Set(deck).size).toBe(53);
    expect(deck.filter((c) => c === JOKER)).toHaveLength(1);
  });

  it("discards pairs of the same rank but never the joker", () => {
    expect(discardPairs(["7S", "7H", "7D", "KC", JOKER, "2H", "2S", "2C", "2D"])).toEqual({
      kept: ["7D", "KC", JOKER],
      pairs: [
        ["7S", "7H"],
        ["2H", "2S"],
        ["2C", "2D"],
      ],
    });
  });

  it("parses a 1-based position, including full-width digits", () => {
    expect(parseDrawIndex("1", 3)).toBe(1);
    expect(parseDrawIndex(" ３ ", 3)).toBe(3);
    expect(parseDrawIndex("0", 3)).toBeNull();
    expect(parseDrawIndex("4", 3)).toBeNull();
    expect(parseDrawIndex("第一張", 3)).toBeNull();
  });
});

describe("game registry", () => {
  it("registers every shared game on the server under its own id", () => {
    expect(Object.keys(SERVER_GAMES).sort()).toEqual(Object.keys(SHARED_GAMES).sort());
    for (const [key, g] of Object.entries(SHARED_GAMES)) expect(g.id).toBe(key);
  });
});

describe("old maid", () => {
  it("deals private hands that only their owners can see", async () => {
    const { players, watchers, all } = await startGame(["Alice", "Bob", "Dave"], ["Carol"]);
    for (const c of all) await c.waitFor(() => game(c).turn === 1);
    await settle(all);
    const [alice, bob, dave] = players;
    const [carol] = watchers;

    const hands = players.map((p) => game(p).myHand!);
    const allCards = hands.flat();
    expect(new Set(allCards).size).toBe(allCards.length);
    expect(allCards.filter((c) => c === JOKER)).toHaveLength(1);
    for (const [i, p] of players.entries()) {
      expect(game(p).counts[p.identity.userId]).toBe(hands[i].length);
      // No pairs left after the initial discard.
      const ranks = hands[i].filter((c) => c !== JOKER).map(rankOf);
      expect(new Set(ranks).size).toBe(ranks.length);
    }
    expect(game(carol).myHand).toBeNull();
    expect(JSON.stringify(carol.received)).not.toContain('"hand"');

    // Each player only ever receives their own hand.
    for (const [i, p] of players.entries()) {
      const handEvents = p.received.filter((e) => e.type === "game_event" && "hand" in e.data);
      expect(handEvents.map((e) => (e.data as unknown as { hand: string[] }).hand)).toEqual([hands[i]]);
    }

    // First turn: Alice draws from Bob. Dave and Carol must not learn which card moved.
    expect(game(dave).drawer).toBe(alice.identity.userId);
    expect(game(dave).target).toBe(bob.identity.userId);
    expect(await alice.act({ type: "text.post", text: "1" })).toMatchObject({ ok: true });
    for (const c of all) await c.waitFor(() => messagesOfType(c, "drew").length === 1);
    await settle(all);
    for (const outsider of [dave, carol]) {
      expect(messagesOfType(outsider, "drew")[0].secret).toBeUndefined();
      expect(JSON.stringify(outsider.received)).not.toContain('"card"');
      const drewEvents = outsider.received.filter((e) => e.type === "game_event" && e.data.event === "drew");
      expect(drewEvents.every((e) => !("hand" in e.data))).toBe(true);
    }
    for (const insider of [alice, bob]) {
      const secret = messagesOfType(insider, "drew")[0].secret?.data as OldMaidDrewSecret;
      expect(secret.card).toBeTruthy();
    }
    for (const c of all) expect(c.view).toEqual(await c.syncFresh());
  });

  it("plays to the end, and the last player holds the joker", async () => {
    const { players, watchers, all } = await startGame(["Alice", "Bob"], ["Carol"]);
    for (let guard = 0; guard < 500; guard++) {
      await settle(all);
      const view = players[0].view!;
      if (view.status === "finished") break;
      const drawer = byId(players, game(players[0]).drawer);
      expect(await drawer.act({ type: "text.post", text: "1" })).toMatchObject({ ok: true });
    }
    await settle(all);
    const alice = players[0];
    expect(alice.view!.status).toBe("finished");
    const final = game(alice);
    const loser = final.loser!;
    expect(loser).toBeTruthy();
    expect(Object.entries(final.counts).filter(([, n]) => n > 0)).toEqual([[loser, 1]]);
    expect(game(byId(players, loser)).myHand).toEqual([JOKER]);
    expect(final.out).toHaveLength(1);
    const result = messagesOfType(watchers[0], "result").at(-1)!;
    expect(result.data.loser).toBe(loser);
    for (const c of all) expect(c.view).toEqual(await c.syncFresh());
  });

  it("accepts only a valid position from the drawer, and treats everyone else's text as chat", async () => {
    const { players, watchers, all } = await startGame(["Alice", "Bob"], ["Carol"]);
    const [alice, bob] = players;
    await alice.waitFor(() => game(alice).turn === 1);
    const target = game(alice).target!;
    const size = game(alice).counts[target];

    expect(await alice.act({ type: "text.post", text: "hello" })).toMatchObject({ ok: false, error: "invalid_draw" });
    expect(await alice.act({ type: "text.post", text: String(size + 1) })).toMatchObject({
      ok: false,
      error: "invalid_draw",
    });
    expect(await bob.act({ type: "text.post", text: "1" })).toMatchObject({ ok: true });
    expect(await watchers[0].act({ type: "text.post", text: "2" })).toMatchObject({ ok: true });
    await settle(all);
    expect(game(alice).turn).toBe(1);
    expect(alice.view!.phase.requirement!.done).toEqual([]);
    expect(messagesOfType(alice, "drew")).toHaveLength(0);
    expect(alice.view!.messages.filter((m) => m.kind === "text").map((m) => m.kind === "text" && m.text)).toEqual([
      "1",
      "2",
    ]);
  });

  it("draws a random card for a drawer who times out", async () => {
    const { sessionId, players, all } = await startGame(["Alice", "Bob"]);
    const [alice] = players;
    await alice.waitFor(() => game(alice).turn === 1);
    await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    for (const c of all) await c.waitFor(() => messagesOfType(c, "drew").length === 1);
    await settle(all);
    expect(messagesOfType(alice, "drew")[0].data).toMatchObject({ drawer: alice.identity.userId, auto: true });
    expect(alice.view!.status === "finished" || game(alice).turn === 2).toBe(true);
    for (const c of all) expect(c.view).toEqual(await c.syncFresh());
  });

  it("draws for a drawer who leaves and keeps the game going", async () => {
    const { players } = await startGame(["Alice", "Bob", "Dave"]);
    const [alice, bob, dave] = players;
    await bob.waitFor(() => game(bob).turn === 1);
    alice.send({ t: "leave" });
    await bob.waitFor(() => messagesOfType(bob, "drew").length >= 1);
    await settle([bob, dave]);
    expect(messagesOfType(bob, "drew")[0].data).toMatchObject({ drawer: alice.identity.userId, auto: true });
    const view = game(bob);
    expect(bob.view!.status === "finished" || view.drawer !== alice.identity.userId).toBe(true);
    expect(bob.view).toEqual(await bob.syncFresh());
  });

  it("replays missed draws on reconnect, including the player's own hand", async () => {
    const { sessionId, players } = await startGame(["Alice", "Bob"]);
    const [alice, bob] = players;
    await bob.waitFor(() => game(bob).turn === 1);
    await settle(players);
    const lastSeq = bob.view!.seq;
    const before = bob.view!;
    bob.close();
    await alice.waitFor(() => alice.view!.participants[1].connected === false);

    // Alice draws from Bob, then Bob's turn times out and the server draws for him.
    expect(await alice.act({ type: "text.post", text: "1" })).toMatchObject({ ok: true });
    if (alice.view!.status === "playing") {
      await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    }

    const bob2 = await TestClient.connect(sessionId, bob.identity, "player", lastSeq);
    const sync = await bob2.waitFor(() => bob2.messages.find((m) => m.t === "sync"));
    expect(sync.t === "sync" && sync.view).toBeNull();
    let rebuilt = before;
    for (const e of sync.t === "sync" ? sync.events : ([] as SessionEvent[])) rebuilt = applyEvent(rebuilt, e);
    const fresh = await bob2.syncFresh();
    expect(rebuilt).toEqual(fresh);
    expect(oldMaidView(fresh)!.myHand).not.toEqual(oldMaidView(before)!.myHand);
  });
});
