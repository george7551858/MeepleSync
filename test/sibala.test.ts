import { describe, expect, it } from "vitest";
import {
  DICE_SYMBOLS,
  DIE_SYMBOL,
  ROLL_TEXT,
  diceSymbols,
  evaluateDice,
  getDieRoles,
  isRollText,
  judgeSibala,
  sibalaView,
  type SibalaMessage,
  type SibalaView,
} from "../src/games/sibala/shared";
import { applyEvent } from "../src/shared/view";
import type { SessionEvent, TextMessage } from "../src/shared/protocol";
import { TestClient, createSession, expireAndRunAlarm, makeIdentity } from "./helpers";

type GameMsg = Extract<TextMessage, { kind: "game" }>;
type Data<T extends SibalaMessage["type"]> = Extract<SibalaMessage, { type: T }>;

function game(client: TestClient): SibalaView {
  return sibalaView(client.view!)!;
}

function sibalaMessages(client: TestClient): GameMsg[] {
  return client.view!.messages.filter((m): m is GameMsg => m.kind === "game" && m.game === "sibala");
}

function messagesOfType<T extends SibalaMessage["type"]>(client: TestClient, type: T) {
  return sibalaMessages(client).filter((m) => (m.data as SibalaMessage).type === type) as (GameMsg & {
    data: Data<T>;
  })[];
}

async function startGame(playerNames: string[], observers: string[] = []) {
  const sessionId = await createSession("sibala");
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

async function settle(clients: TestClient[]) {
  const seq = Math.max(...clients.map((c) => c.view!.seq));
  for (const c of clients) await c.waitFor(() => c.view!.seq >= seq);
}

function byId(clients: TestClient[], userId: string | null) {
  return clients.find((c) => c.identity.userId === userId)!;
}

describe("十八骰仔 (sibala) rules", () => {
  it("formats dice with ⚀⚁⚂⚃⚄⚅ symbols", () => {
    expect(DICE_SYMBOLS).toEqual(["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]);
    expect(diceSymbols([1, 2, 3, 4])).toBe("⚀ ⚁ ⚂ ⚃");
    expect(diceSymbols([5, 6, 1, 6])).toBe("⚄ ⚅ ⚀ ⚅");
    expect(DIE_SYMBOL[6]).toBe("⚅");
  });

  it("evaluates four of a kind (一色), points (點數 / 十八 / BG), and 無點", () => {
    // Four of a kind (一色)
    const quad6 = evaluateDice([6, 6, 6, 6]);
    expect(quad6).toMatchObject({ kind: "quad", pair: 6, points: null, rank: 106, label: "⚅ 一色" });
    const quad1 = evaluateDice([1, 1, 1, 1]);
    expect(quad1).toMatchObject({ kind: "quad", pair: 1, points: null, rank: 101, label: "⚀ 一色" });
    expect(quad6.rank).toBeGreaterThan(quad1.rank);

    // Two pairs: smaller pair set aside, larger pair summed
    const siba = evaluateDice([6, 2, 6, 2]);
    expect(siba).toMatchObject({ kind: "points", pair: 2, points: 12, rank: 12, label: "十八（12 點）" });
    expect(quad1.rank).toBeGreaterThan(siba.rank);

    const twoPair10 = evaluateDice([5, 3, 5, 3]);
    expect(twoPair10).toMatchObject({ kind: "points", pair: 3, points: 10, rank: 10, label: "10 點" });

    // Single pair
    const bg = evaluateDice([4, 1, 4, 2]);
    expect(bg).toMatchObject({ kind: "points", pair: 4, points: 3, rank: 3, label: "BG（3 點）" });

    const nine = evaluateDice([1, 1, 3, 6]);
    expect(nine).toMatchObject({ kind: "points", pair: 1, points: 9, rank: 9, label: "9 點" });

    // 無點: 4 distinct or 3 of a kind
    expect(evaluateDice([1, 2, 3, 4])).toMatchObject({ kind: "none", points: null, pair: null, rank: 0, label: "無點" });
    expect(evaluateDice([5, 5, 5, 2])).toMatchObject({ kind: "none", points: null, pair: null, rank: 0, label: "無點" });
    expect(evaluateDice([1, 4, 4, 4])).toMatchObject({ kind: "none", points: null, pair: null, rank: 0, label: "無點" });
  });

  it("judges winners and draws", () => {
    const r8 = evaluateDice([2, 2, 3, 5]);
    const r12 = evaluateDice([1, 1, 6, 6]);
    const q3 = evaluateDice([3, 3, 3, 3]);

    expect(judgeSibala(["a", "b"], { a: r8, b: r12 })).toEqual({ winners: ["b"], draw: false });
    expect(judgeSibala(["a", "b"], { a: q3, b: r12 })).toEqual({ winners: ["a"], draw: false });
    expect(judgeSibala(["a", "b"], { a: r8, b: r8 })).toEqual({ winners: [], draw: true });
    expect(judgeSibala(["a", "b", "c"], { a: r12, b: r12, c: r8 })).toEqual({
      winners: ["a", "b"],
      draw: false,
    });
  });

  it("validates roll input text", () => {
    expect(isRollText(ROLL_TEXT)).toBe(true);
    expect(isRollText(" 十八啦 ")).toBe(true);
    expect(isRollText("擲骰")).toBe(true);
    expect(isRollText("⚅")).toBe(true);
    expect(isRollText("hello")).toBe(false);
    expect(isRollText("")).toBe(false);
  });

  it("identifies pair vs scoring point dice roles for background hints", () => {
    const r11 = evaluateDice([3, 3, 5, 6]);
    expect(getDieRoles(r11)).toEqual(["pair", "pair", "point", "point"]);

    const siba = evaluateDice([6, 2, 6, 2]);
    // 2 is pair, 6s are points (12 points)
    expect(getDieRoles(siba)).toEqual(["point", "pair", "point", "pair"]);

    const quad = evaluateDice([4, 4, 4, 4]);
    expect(getDieRoles(quad)).toEqual(["quad", "quad", "quad", "quad"]);

    const none = evaluateDice([1, 2, 3, 4]);
    expect(getDieRoles(none)).toEqual(["none", "none", "none", "none"]);
  });
});

describe("十八骰仔 (sibala) session integration", () => {
  it("plays a full game to completion and keeps views equal to fresh snapshots", async () => {
    const { players, watchers, all } = await startGame(["Alice", "Bob", "Dave"], ["Carol"]);
    for (const c of all) await c.waitFor(() => game(c).turn === 1);
    await settle(all);

    expect(messagesOfType(players[0], "started")).toHaveLength(1);
    expect(game(players[0]).roller).toBe(players[0].identity.userId);

    for (let guard = 0; guard < 30; guard++) {
      await settle(all);
      if (players[0].view!.status === "finished") break;
      const currentRoller = byId(players, game(players[0]).roller);
      expect(await currentRoller.act({ type: "text.post", text: ROLL_TEXT })).toMatchObject({ ok: true });
    }

    await settle(all);
    const alice = players[0];
    expect(alice.view!.status).toBe("finished");
    const final = game(alice);
    expect(final.roller).toBeNull();
    for (const p of players) {
      const r = final.rolls[p.identity.userId];
      expect(r).toBeTruthy();
      expect(r!.kind).not.toBe("none");
      expect(r!.dice).toHaveLength(4);
    }
    const results = messagesOfType(watchers[0], "result");
    expect(results).toHaveLength(1);
    expect(results[0].data.winners).toEqual(final.winners);
    expect(results[0].data.draw).toBe(final.draw);

    for (const c of all) expect(c.view).toEqual(await c.syncFresh());
  });

  it("accepts only valid roll text from the current roller, and treats others' text as chat", async () => {
    const { players, watchers, all } = await startGame(["Alice", "Bob"], ["Carol"]);
    const [alice, bob] = players;
    const [carol] = watchers;
    await alice.waitFor(() => game(alice).turn === 1);

    expect(await alice.act({ type: "text.post", text: "隨便聊聊" })).toMatchObject({
      ok: false,
      error: "invalid_roll",
    });
    // Non-roller player and observer text is posted as free chat
    expect(await bob.act({ type: "text.post", text: ROLL_TEXT })).toMatchObject({ ok: true });
    expect(await carol.act({ type: "text.post", text: ROLL_TEXT })).toMatchObject({ ok: true });
    await settle(all);

    expect(game(alice).turn).toBe(1);
    expect(messagesOfType(alice, "rolled")).toHaveLength(0);
    expect(alice.view!.messages.filter((m) => m.kind === "text").map((m) => m.kind === "text" && m.text)).toEqual([
      ROLL_TEXT,
      ROLL_TEXT,
    ]);
  });

  it("auto-rolls for a roller who times out", async () => {
    const { sessionId, players, all } = await startGame(["Alice", "Bob"]);
    const [alice, bob] = players;
    await alice.waitFor(() => game(alice).turn === 1);

    await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    for (const c of all) await c.waitFor(() => messagesOfType(c, "rolled").length === 1);
    await settle(all);

    expect(messagesOfType(alice, "rolled")[0].data).toMatchObject({
      userId: alice.identity.userId,
      auto: true,
    });
    expect(game(alice).rolls[alice.identity.userId]?.kind).not.toBe("none");
    expect(game(alice).roller).toBe(bob.identity.userId);
    for (const c of all) expect(c.view).toEqual(await c.syncFresh());
  });

  it("auto-rolls for a roller who leaves and keeps the game going", async () => {
    const { players } = await startGame(["Alice", "Bob", "Dave"]);
    const [alice, bob, dave] = players;
    await bob.waitFor(() => game(bob).turn === 1);

    alice.send({ t: "leave" });
    await bob.waitFor(() => messagesOfType(bob, "rolled").length >= 1);
    await settle([bob, dave]);

    expect(messagesOfType(bob, "rolled")[0].data).toMatchObject({
      userId: alice.identity.userId,
      auto: true,
    });
    expect(game(bob).roller).toBe(bob.identity.userId);
    expect(bob.view).toEqual(await bob.syncFresh());
  });

  it("replays missed rolls on reconnect and matches a fresh snapshot", async () => {
    const { sessionId, players } = await startGame(["Alice", "Bob"]);
    const [alice, bob] = players;
    await bob.waitFor(() => game(bob).turn === 1);
    await settle(players);

    const lastSeq = bob.view!.seq;
    const before = bob.view!;
    bob.close();
    await alice.waitFor(() => alice.view!.participants[1].connected === false);

    // Alice rolls until her turn completes, then Bob's turn times out
    while (alice.view!.status === "playing" && game(alice).roller === alice.identity.userId) {
      expect(await alice.act({ type: "text.post", text: ROLL_TEXT })).toMatchObject({ ok: true });
    }
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
    expect(fresh.status).toBe("finished");
  });
});
