import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { HAND_TEXT, verifyCommitment, type Hand } from "../src/shared/games/rps";
import { CloseCode, MESSAGE_HISTORY, TEXT_MAX_LENGTH, type GameMode, type TextMessage } from "../src/shared/protocol";
import type { SessionDO } from "../src/worker/session";
import type { SessionState } from "../src/worker/store";
import { TestClient, createSession, makeIdentity, sessionStub } from "./helpers";

type Msg<K extends TextMessage["kind"]> = Extract<TextMessage, { kind: K }>;

function choose(client: TestClient, hand: Hand, phaseId?: number) {
  return client.act({ type: "text.post", text: HAND_TEXT[hand] }, undefined, phaseId);
}

function latestResult(client: TestClient) {
  return client.view!.messages.filter((m): m is Msg<"rps_result"> => m.kind === "rps_result").at(-1);
}

function commitOf(client: TestClient, userId: string) {
  return client.view!.messages.filter((m): m is Msg<"commit"> => m.kind === "commit" && m.userId === userId).at(-1);
}

function texts(client: TestClient) {
  return client.view!.messages.filter((m): m is Msg<"text"> => m.kind === "text");
}

async function lobbyWithTwo(mode: GameMode = "rps") {
  const sessionId = await createSession(mode);
  const alice = await TestClient.connect(sessionId, makeIdentity("Alice"));
  await alice.ready();
  const bob = await TestClient.connect(sessionId, makeIdentity("Bob"));
  await bob.ready();
  await alice.waitFor(() => alice.view!.participants.length === 2);
  return { sessionId, alice, bob };
}

/** Mutate authoritative state inside the DO (e.g. move a deadline into the past), then fire the alarm. */
async function expireAndRunAlarm(sessionId: string, mutate: (s: SessionState) => void) {
  const stub = sessionStub(sessionId);
  await runInDurableObject(stub, (instance: SessionDO) => {
    mutate((instance as unknown as { state: SessionState }).state);
  });
  return runDurableObjectAlarm(stub);
}

describe("session lifecycle", () => {
  it("creates a session with a short shareable id", async () => {
    const sessionId = await createSession();
    expect(sessionId).toMatch(/^[23456789a-z]{8}$/);
  });

  it("closes with NotFound for unknown sessions", async () => {
    const client = await TestClient.connect("zzzzzzzz", makeIdentity("Ghost"));
    await client.waitFor(() => client.closeCode);
    expect(client.closeCode).toBe(CloseCode.NotFound);
  });

  it("makes the first player host and shows everyone joining", async () => {
    const { alice, bob } = await lobbyWithTwo();
    expect(alice.view!.hostId).toBe(alice.identity.userId);
    expect(bob.view!.participants.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("rejects a hello whose secret does not match the bound identity", async () => {
    const { sessionId, alice } = await lobbyWithTwo();
    const impostor = await TestClient.connect(sessionId, { ...alice.identity, secret: "x".repeat(32) });
    await impostor.waitFor(() => impostor.closeCode);
    expect(impostor.closeCode).toBe(CloseCode.Rejected);
  });

  it("replaces an older connection of the same user", async () => {
    const { sessionId, alice } = await lobbyWithTwo();
    const second = await TestClient.connect(sessionId, alice.identity);
    await second.ready();
    await alice.waitFor(() => alice.closeCode);
    expect(alice.closeCode).toBe(CloseCode.Replaced);
    expect(second.view!.participants.find((p) => p.userId === alice.identity.userId)!.connected).toBe(true);
  });

  it("removes a participant who leaves in the lobby and transfers host", async () => {
    const { alice, bob } = await lobbyWithTwo();
    alice.send({ t: "leave" });
    await alice.waitFor(() => alice.closeCode);
    expect(alice.closeCode).toBe(CloseCode.Left);
    await bob.waitFor(() => bob.view!.participants.length === 1);
    expect(bob.view!.hostId).toBe(bob.identity.userId);
  });
});

describe("action validation", () => {
  it("executes a retried action only once", async () => {
    const { alice, bob } = await lobbyWithTwo();
    const actionId = crypto.randomUUID();
    const first = await bob.act({ type: "set_role", role: "observer" }, actionId);
    const retry = await bob.act({ type: "set_role", role: "observer" }, actionId);
    expect(first).toMatchObject({ ok: true });
    expect(retry).toMatchObject({ ok: true });
    await alice.waitFor(() => alice.view!.participants[1].role === "observer");
    const roleEvents = alice.received.filter((e) => e.type === "participant_updated" && "role" in e.data.changes);
    expect(roleEvents).toHaveLength(1);
  });

  it("rejects actions targeting an old phase", async () => {
    const { alice } = await lobbyWithTwo();
    const oldPhase = alice.view!.phase.id;
    expect(await alice.act({ type: "start" })).toMatchObject({ ok: true });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    expect(await choose(alice, "rock", oldPhase)).toMatchObject({ ok: false, error: "stale_phase" });
  });

  it("only lets the host start", async () => {
    const { bob } = await lobbyWithTwo();
    expect(await bob.act({ type: "start" })).toMatchObject({ ok: false, error: "host_only" });
  });

  it("hides a submitted choice from other players and observers", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    const carol = await TestClient.connect(sessionId, makeIdentity("Carol"), "observer");
    await carol.ready();
    await alice.act({ type: "start" });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");

    expect(await choose(alice, "paper")).toMatchObject({ ok: true });
    await carol.waitFor(() => commitOf(carol, alice.identity.userId));
    await bob.waitFor(() => commitOf(bob, alice.identity.userId));

    expect(commitOf(alice, alice.identity.userId)!.text).toBe(HAND_TEXT.paper);
    expect(commitOf(bob, alice.identity.userId)!.text).toBeUndefined();
    for (const other of [bob, carol]) {
      expect(JSON.stringify(other.received)).not.toContain("paper");
      expect(JSON.stringify(other.received)).not.toContain(HAND_TEXT.paper);
      expect(other.view).toEqual(await other.syncFresh());
    }
    expect(alice.view).toEqual(await alice.syncFresh());
    expect(bob.view!.phase.requirement!.done).toEqual([alice.identity.userId]);
  });

  it("only accepts the three hands from a player who still has to choose", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    const carol = await TestClient.connect(sessionId, makeIdentity("Carol"), "observer");
    await carol.ready();
    await alice.act({ type: "start" });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");

    expect(await alice.act({ type: "text.post", text: "hello" })).toMatchObject({ ok: false, error: "invalid_choice" });
    expect(await carol.act({ type: "text.post", text: "go Alice" })).toMatchObject({ ok: true });
    await choose(alice, "rock");
    expect(await alice.act({ type: "text.post", text: HAND_TEXT.paper })).toMatchObject({ ok: true });

    await bob.waitFor(() => texts(bob).length === 2);
    expect(texts(bob).map((m) => [m.name, m.text])).toEqual([
      ["Carol", "go Alice"],
      ["Alice", HAND_TEXT.paper],
    ]);
    expect(bob.view!.phase.requirement!.done).toEqual([alice.identity.userId]);
  });
});

describe("rock paper scissors", () => {
  it("reveals into the text history when everyone committed, and commitments verify", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    await alice.act({ type: "start", rounds: 1 });
    await bob.waitFor(() => bob.view!.phase.name === "choosing");
    await choose(alice, "rock");
    await choose(bob, "scissors");

    await bob.waitFor(() => bob.view!.phase.name === "revealed");
    const message = latestResult(bob)!;
    const { result } = message;
    expect(result.winners).toEqual([alice.identity.userId]);
    expect(message.final).toBe(true);
    expect(message.names).toEqual({ [alice.identity.userId]: "Alice", [bob.identity.userId]: "Bob" });
    expect(message.scores[alice.identity.userId]).toBe(1);
    expect(bob.view!.game!.scores[alice.identity.userId]).toBe(1);
    for (const [userId, pick] of Object.entries(result.picks)) {
      expect(result.commitments[userId]).toBe(commitOf(bob, userId)!.commitment);
      expect(await verifyCommitment(sessionId, 1, userId, pick!, result.commitments[userId])).toBe(true);
    }

    expect(await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1))).toBe(true);
    await bob.waitFor(() => bob.view!.status === "finished");
    expect(bob.view!.phase.name).toBe("finished");
  });

  it("advances on timeout and counts a missing choice as a loss", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    await alice.act({ type: "start" });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    await choose(alice, "rock");

    await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    await bob.waitFor(() => bob.view!.phase.name === "revealed");
    const { result } = latestResult(bob)!;
    expect(result.picks[bob.identity.userId]).toBeNull();
    expect(result.winners).toEqual([alice.identity.userId]);

    await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    await bob.waitFor(() => bob.view!.phase.name === "choosing" && bob.view!.game!.round === 2);
  });

  it("returns to the lobby when the host restarts a finished game", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    await alice.act({ type: "start", rounds: 1 });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    await choose(alice, "rock");
    await choose(bob, "rock");
    await expireAndRunAlarm(sessionId, (s) => (s.phase.deadline = Date.now() - 1));
    await alice.waitFor(() => alice.view!.status === "finished");

    expect(await alice.act({ type: "restart" })).toMatchObject({ ok: true });
    await bob.waitFor(() => bob.view!.status === "lobby");
    expect(bob.view!.game).toBeNull();
  });
});

describe("disconnect and recovery", () => {
  it("replays missed events on reconnect and ends up equal to a fresh snapshot", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    const lastSeq = bob.view!.seq;
    const bobView = bob.view!;
    bob.close();
    await alice.waitFor(() => alice.view!.participants[1].connected === false);

    await alice.act({ type: "start" });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    await choose(alice, "paper");

    const bob2 = await TestClient.connect(sessionId, bob.identity, "player", lastSeq);
    await bob2.waitFor(() => bob2.messages.find((m) => m.t === "sync"));
    const sync = bob2.messages.find((m) => m.t === "sync")!;
    expect(sync.t === "sync" && sync.view).toBeNull();
    expect(sync.t === "sync" && sync.events[0].seq).toBe(lastSeq + 1);

    // Rebuild from the pre-disconnect view plus replayed events.
    let rebuilt = bobView;
    const { applyEvent } = await import("../src/shared/view");
    for (const e of sync.t === "sync" ? sync.events : []) rebuilt = applyEvent(rebuilt, e);
    expect(rebuilt).toEqual(await bob2.syncFresh());
    expect(rebuilt.participants.find((p) => p.userId === bob.identity.userId)!.connected).toBe(true);
  });

  it("keeps state consistent for a live client across a full game", async () => {
    const { alice, bob } = await lobbyWithTwo();
    await alice.act({ type: "start", rounds: 1 });
    await bob.waitFor(() => bob.view!.phase.name === "choosing");
    await choose(bob, "paper");
    await choose(alice, "rock");
    await bob.waitFor(() => bob.view!.phase.name === "revealed");
    expect(bob.view).toEqual(await bob.syncFresh());
    expect(alice.view).toEqual(await alice.syncFresh());
  });

  it("removes a lobby participant after the disconnect grace period", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    bob.close();
    await alice.waitFor(() => alice.view!.participants[1].connected === false);
    await expireAndRunAlarm(sessionId, (s) => {
      s.participants[bob.identity.userId].disconnectedAt = Date.now() - 10 * 60_000;
    });
    await alice.waitFor(() => alice.view!.participants.length === 1);
  });

  it("marks an in-game player as left after the grace period and stops waiting for them", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    await alice.act({ type: "start" });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    await choose(alice, "rock");
    bob.close();
    await alice.waitFor(() => alice.view!.participants[1].connected === false);
    await expireAndRunAlarm(sessionId, (s) => {
      s.participants[bob.identity.userId].disconnectedAt = Date.now() - 10 * 60_000;
    });
    await alice.waitFor(() => alice.view!.phase.name === "revealed");
    expect(alice.view!.participants[1].left).toBe(true);
  });

  it("deletes an idle session with no connections", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo();
    alice.send({ t: "leave" });
    bob.send({ t: "leave" });
    await alice.waitFor(() => alice.closeCode);
    await bob.waitFor(() => bob.closeCode);
    await expireAndRunAlarm(sessionId, (s) => (s.lastActivity = 0));
    const late = await TestClient.connect(sessionId, makeIdentity("Late"));
    await late.waitFor(() => late.closeCode);
    expect(late.closeCode).toBe(CloseCode.NotFound);
  });
});

describe("game mode", () => {
  it("defaults to text mode when created without a mode", async () => {
    const res = await exports.default.fetch("http://test/api/sessions", { method: "POST" });
    const { sessionId } = (await res.json()) as { sessionId: string };
    const alice = await TestClient.connect(sessionId, makeIdentity("Alice"));
    expect((await alice.ready()).mode).toBe("text");
  });

  it("has no game to start in text mode", async () => {
    const { alice } = await lobbyWithTwo("text");
    expect(await alice.act({ type: "start" })).toMatchObject({ ok: false, error: "no_game" });
  });

  it("lets only the host switch mode, and only in the lobby", async () => {
    const { alice, bob } = await lobbyWithTwo("text");
    expect(await bob.act({ type: "set_mode", mode: "rps" })).toMatchObject({ ok: false, error: "host_only" });
    expect(await alice.act({ type: "set_mode", mode: "rps" })).toMatchObject({ ok: true });
    await bob.waitFor(() => bob.view!.mode === "rps");

    expect(await alice.act({ type: "start" })).toMatchObject({ ok: true });
    await alice.waitFor(() => alice.view!.phase.name === "choosing");
    expect(await alice.act({ type: "set_mode", mode: "text" })).toMatchObject({ ok: false, error: "not_allowed_now" });
  });
});

describe("text messages", () => {
  it("delivers text from players and observers to everyone, once per actionId", async () => {
    const { sessionId, alice, bob } = await lobbyWithTwo("text");
    const carol = await TestClient.connect(sessionId, makeIdentity("Carol"), "observer");
    await carol.ready();

    const actionId = crypto.randomUUID();
    expect(await carol.act({ type: "text.post", text: "  hello  " }, actionId)).toMatchObject({ ok: true });
    expect(await carol.act({ type: "text.post", text: "  hello  " }, actionId)).toMatchObject({ ok: true });
    await alice.act({ type: "text.post", text: "hi Carol" });

    await bob.waitFor(() => bob.view!.messages.length === 2);
    expect(texts(bob).map((m) => [m.name, m.text])).toEqual([
      ["Carol", "hello"],
      ["Alice", "hi Carol"],
    ]);
    expect(bob.view).toEqual(await bob.syncFresh());
  });

  it("rejects empty and over-long text", async () => {
    const { alice } = await lobbyWithTwo("text");
    expect(await alice.act({ type: "text.post", text: "   " })).toMatchObject({ ok: false, error: "invalid_text" });
    const tooLong = "a".repeat(TEXT_MAX_LENGTH + 1);
    expect(await alice.act({ type: "text.post", text: tooLong })).toMatchObject({ ok: false, error: "invalid_text" });
  });

  it("accepts free text with a stale phase, but not a pending player's move", async () => {
    const { alice, bob } = await lobbyWithTwo("rps");
    const oldPhase = alice.view!.phase.id;
    await alice.act({ type: "start" });
    await bob.waitFor(() => bob.view!.phase.name === "choosing");
    expect(await bob.act({ type: "text.post", text: "good luck" }, undefined, oldPhase)).toMatchObject({
      ok: false,
      error: "stale_phase",
    });
    await choose(bob, "rock");
    expect(await bob.act({ type: "text.post", text: "good luck" }, undefined, oldPhase)).toMatchObject({ ok: true });
  });

  it("keeps only the most recent messages, identically in replayed views and snapshots", async () => {
    const { alice, bob } = await lobbyWithTwo("text");
    for (let i = 0; i <= MESSAGE_HISTORY; i++) await alice.act({ type: "text.post", text: `m${i}` });
    await bob.waitFor(() => texts(bob).at(-1)?.text === `m${MESSAGE_HISTORY}`);
    expect(bob.view!.messages).toHaveLength(MESSAGE_HISTORY);
    expect(texts(bob)[0].text).toBe("m1");
    expect(bob.view).toEqual(await bob.syncFresh());
  });
});
