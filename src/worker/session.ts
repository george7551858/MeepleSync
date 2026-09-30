import { DurableObject } from "cloudflare:workers";
import { createHash } from "node:crypto";
import {
  CloseCode,
  PING,
  PONG,
  isGameMode,
  normalizeName,
  normalizeText,
  type Action,
  type ClientMessage,
  type EventBody,
  type GameMode,
  type ParticipantChanges,
  type ParticipantView,
  type ServerMessage,
  type SessionView,
  type TextMessage,
} from "../shared/protocol";
import { pushMessage, sortParticipants } from "../shared/view";
import {
  ACTION_CACHE_MS,
  DISCONNECT_GRACE_MS,
  EVENT_LOG_LIMIT,
  IDLE_MS,
  MAX_MESSAGE_BYTES,
  MAX_PARTICIPANTS,
  MAX_PLAYERS,
} from "./config";
import { rps } from "./games/rps";
import type { GameContext, GameModule, PhaseOptions } from "./games/types";
import {
  Store,
  projectEvent,
  type ActionResult,
  type EventSecret,
  type Participant,
  type RawEvent,
  type SessionState,
} from "./store";

const GAMES: Record<string, GameModule<any>> = { [rps.kind]: rps };
const PLATFORM_ACTIONS = new Set(["start", "restart", "set_role", "set_mode", "text.post"]);
const HOST_ACTIONS = new Set(["start", "restart", "set_mode"]);

interface Attachment {
  userId: string | null;
}

/** Collects the events produced by one state transition. */
class Tx {
  readonly events: RawEvent[] = [];
  constructor(
    readonly now: number,
    readonly actorId: string | null,
    readonly actionId: string | null,
  ) {}
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

export class SessionDO extends DurableObject<Env> {
  private readonly store: Store;
  private state: SessionState | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    this.state = this.store.loadState();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // ---------------------------------------------------------------- RPC

  init(sessionId: string, mode: GameMode): boolean {
    if (this.state) return false;
    const now = Date.now();
    this.store.migrate();
    this.state = {
      sessionId,
      createdAt: now,
      status: "lobby",
      mode,
      hostId: null,
      seq: 0,
      phase: { id: 1, name: "lobby", startedAt: now, deadline: null, requirement: null },
      participants: {},
      game: null,
      messages: [],
      lastActivity: now,
    };
    this.store.saveState(this.state);
    this.scheduleAlarm();
    return true;
  }

  debugLog(): RawEvent[] {
    return this.state ? this.store.eventsAfter(0) : [];
  }

  // ---------------------------------------------------------------- WebSocket

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
    if (!this.state) return this.reject(ws, CloseCode.NotFound, "session_not_found");

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { t: "error", code: "bad_message", message: "invalid JSON" });
    }

    if (msg.t === "hello") return this.onHello(ws, msg);

    const userId = (ws.deserializeAttachment() as Attachment | null)?.userId;
    if (!userId || !this.state.participants[userId]) {
      return this.send(ws, { t: "error", code: "not_joined", message: "send hello first" });
    }
    switch (msg.t) {
      case "action":
        return this.onAction(ws, userId, msg);
      case "sync":
        return this.sendSync(ws, userId, msg.lastSeq);
      case "leave":
        return this.onLeave(ws, userId);
      default:
        return this.send(ws, { t: "error", code: "bad_message", message: "unknown message type" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws);
  }

  private onDisconnect(ws: WebSocket): void {
    if (!this.state) return;
    if (!this.markDisconnected(ws)) this.scheduleAlarm();
  }

  // ---------------------------------------------------------------- Alarm

  async alarm(): Promise<void> {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    const tx = new Tx(now, null, null);

    if (s.phase.deadline !== null && now >= s.phase.deadline && s.game) {
      GAMES[s.game.kind].onPhaseEnd(this.gameContext(tx), s.game.state, s.phase.name);
      this.checkRequirement(tx);
    }

    for (const p of Object.values(s.participants)) {
      if (!p.connected && !p.left && p.disconnectedAt !== null && now >= p.disconnectedAt + DISCONNECT_GRACE_MS) {
        this.vacate(tx, p.userId, "timeout");
      }
    }

    if (tx.events.length) return this.commit(tx);

    if (!this.hasLiveSocket() && now >= s.lastActivity + IDLE_MS) {
      console.log(JSON.stringify({ msg: "session_expired", sessionId: s.sessionId }));
      this.state = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    this.scheduleAlarm();
  }

  // ---------------------------------------------------------------- Handlers

  private onHello(ws: WebSocket, msg: Extract<ClientMessage, { t: "hello" }>): void {
    const s = this.state!;
    const name = normalizeName(msg.name);
    const validId = typeof msg.userId === "string" && /^[\w-]{8,64}$/.test(msg.userId);
    const validSecret = typeof msg.secret === "string" && msg.secret.length >= 16 && msg.secret.length <= 128;
    if (!validId || !validSecret || !name) return this.reject(ws, CloseCode.Rejected, "bad_hello");

    const { userId } = msg;
    const secretHash = sha256(msg.secret);
    let p = s.participants[userId];
    if (p && p.secretHash !== secretHash) return this.reject(ws, CloseCode.Rejected, "identity_mismatch");
    if (!p && Object.keys(s.participants).length >= MAX_PARTICIPANTS) {
      return this.reject(ws, CloseCode.Rejected, "session_full");
    }

    for (const other of this.ctx.getWebSockets()) {
      if (other === ws || (other.deserializeAttachment() as Attachment | null)?.userId !== userId) continue;
      other.serializeAttachment({ userId: null } satisfies Attachment);
      other.close(CloseCode.Replaced, "replaced");
    }
    ws.serializeAttachment({ userId } satisfies Attachment);

    const tx = new Tx(Date.now(), userId, null);
    if (!p) {
      const canPlay = msg.role === "player" && s.status === "lobby" && this.playerCount() < MAX_PLAYERS;
      p = {
        userId,
        name,
        role: canPlay ? "player" : "observer",
        joinedAt: tx.now,
        connected: true,
        left: false,
        secretHash,
        disconnectedAt: null,
      };
      s.participants[userId] = p;
      this.emit(tx, { type: "participant_joined", data: { participant: this.participantView(p) } });
      if (!s.hostId) this.setHost(tx, userId);
    } else {
      const changes: ParticipantChanges = {};
      if (!p.connected) changes.connected = true;
      if (p.left) changes.left = false;
      if (p.name !== name) changes.name = name;
      Object.assign(p, changes, { disconnectedAt: null });
      if (Object.keys(changes).length) this.emit(tx, { type: "participant_updated", data: { userId, changes } });
    }
    this.commit(tx, ws);
    this.sendSync(ws, userId, typeof msg.lastSeq === "number" ? msg.lastSeq : null);
  }

  private onAction(ws: WebSocket, userId: string, msg: Extract<ClientMessage, { t: "action" }>): void {
    const { actionId } = msg;
    if (typeof actionId !== "string" || !actionId || actionId.length > 64 || typeof msg.action?.type !== "string") {
      return this.send(ws, { t: "error", code: "bad_action", message: "malformed action" });
    }

    const cached = this.store.getAction(actionId);
    if (cached) {
      const result = cached.userId === userId ? cached.result : fail("duplicate_action_id");
      return this.send(ws, { t: "ack", actionId, ...result });
    }

    const now = Date.now();
    const result = this.applyAction(new Tx(now, userId, actionId), userId, msg.phaseId, msg.action);
    this.store.putAction(actionId, userId, now, result);
    if (!result.ok) {
      console.log(JSON.stringify({ msg: "action_rejected", sessionId: this.state!.sessionId, userId, actionId, type: msg.action.type, error: result.error }));
    }
    this.send(ws, { t: "ack", actionId, ...result });
  }

  /** Validation order: identity -> role -> phase -> actor -> game rules. */
  private applyAction(tx: Tx, userId: string, phaseId: unknown, action: Action): ActionResult {
    const s = this.state!;
    const p = s.participants[userId];
    if (!p || p.left) return fail("not_participant");
    // Text is not tied to any phase, so it must not fail with stale_phase when a phase changes mid-send.
    if (action.type === "text.post") return this.postText(tx, p, action.text);

    if (!PLATFORM_ACTIONS.has(action.type) && p.role !== "player") return fail("observer_cannot_act");
    if (HOST_ACTIONS.has(action.type) && s.hostId !== userId) return fail("host_only");
    if (phaseId !== s.phase.id) return fail("stale_phase");
    if (s.phase.deadline !== null && tx.now > s.phase.deadline) return fail("phase_expired");

    switch (action.type) {
      case "set_role": {
        if (s.status !== "lobby") return fail("not_allowed_now");
        if (action.role !== "player" && action.role !== "observer") return fail("invalid_role");
        if (action.role === p.role) return { ok: true };
        if (action.role === "player" && this.playerCount() >= MAX_PLAYERS) return fail("too_many_players");
        p.role = action.role;
        this.emit(tx, { type: "participant_updated", data: { userId, changes: { role: action.role } } });
        break;
      }
      case "set_mode": {
        if (s.status !== "lobby") return fail("not_allowed_now");
        if (!isGameMode(action.mode)) return fail("invalid_mode");
        if (action.mode === s.mode) return { ok: true };
        s.mode = action.mode;
        this.emit(tx, { type: "mode_changed", data: { mode: action.mode } });
        break;
      }
      case "start": {
        if (s.status !== "lobby") return fail("not_allowed_now");
        const game = GAMES[s.mode];
        if (!game) return fail("no_game");
        const players = this.activePlayers();
        if (players.length < game.minPlayers) return fail("not_enough_players");
        const rounds = typeof action.rounds === "number" ? action.rounds : undefined;
        const gameState = game.create(players, { rounds });
        s.game = { kind: game.kind, state: gameState };
        s.status = "playing";
        this.emit(tx, { type: "status_changed", data: { status: "playing" } });
        this.emit(tx, { type: "game_set", data: { game: game.project(gameState, null) } });
        game.begin(this.gameContext(tx), gameState);
        this.checkRequirement(tx);
        break;
      }
      case "restart": {
        if (s.status !== "finished") return fail("not_allowed_now");
        s.status = "lobby";
        s.game = null;
        this.emit(tx, { type: "status_changed", data: { status: "lobby" } });
        this.emit(tx, { type: "game_set", data: { game: null } });
        for (const q of Object.values(s.participants)) {
          if (q.left) this.removeParticipant(tx, q.userId, "cleanup");
        }
        this.setPhase(tx, "lobby");
        break;
      }
      default: {
        const req = s.phase.requirement;
        if (s.status !== "playing" || !s.game || !req || req.actionType !== action.type) return fail("not_allowed_now");
        if (!req.actors.includes(userId)) return fail("not_your_turn");
        if (req.done.includes(userId)) return fail("already_done");
        const error = GAMES[s.game.kind].onAction(this.gameContext(tx), s.game.state, userId, action);
        if (error) return fail(error);
        req.done.push(userId);
        this.emit(tx, { type: "requirement_done", data: { userId } });
        this.checkRequirement(tx);
      }
    }
    this.commit(tx);
    return { ok: true };
  }

  private postText(tx: Tx, p: Participant, raw: unknown): ActionResult {
    const text = normalizeText(raw);
    if (!text) return fail("invalid_text");
    const s = this.state!;
    const message: TextMessage = { id: s.seq + 1, userId: p.userId, name: p.name, text, ts: tx.now };
    pushMessage(s.messages, message);
    this.emit(tx, { type: "text_posted", data: { message } });
    this.commit(tx);
    return { ok: true };
  }

  private onLeave(ws: WebSocket, userId: string): void {
    const tx = new Tx(Date.now(), userId, null);
    this.vacate(tx, userId, "leave");
    ws.serializeAttachment({ userId: null } satisfies Attachment);
    this.commit(tx);
    ws.close(CloseCode.Left, "left");
  }

  /** Returns true when a presence change was committed (which also reschedules the alarm). */
  private markDisconnected(ws: WebSocket): boolean {
    const s = this.state!;
    const userId = (ws.deserializeAttachment() as Attachment | null)?.userId;
    if (!userId) return false;
    const stillConnected = this.ctx
      .getWebSockets()
      .some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.userId === userId);
    const p = s.participants[userId];
    if (stillConnected || !p || !p.connected) return false;

    const tx = new Tx(Date.now(), userId, null);
    p.connected = false;
    p.disconnectedAt = tx.now;
    this.emit(tx, { type: "participant_updated", data: { userId, changes: { connected: false } } });
    this.commit(tx);
    return true;
  }

  // ---------------------------------------------------------------- Transitions

  private emit(tx: Tx, body: EventBody, secret?: EventSecret): void {
    const s = this.state!;
    const event: RawEvent = {
      seq: ++s.seq,
      ts: tx.now,
      type: body.type,
      data: body.data as Record<string, unknown>,
      secret: secret ?? null,
      actorId: tx.actorId,
      actionId: tx.actionId,
    };
    this.store.appendEvent(event);
    tx.events.push(event);
    console.log(
      JSON.stringify({ msg: "session_event", sessionId: s.sessionId, seq: event.seq, type: event.type, actorId: tx.actorId, actionId: tx.actionId }),
    );
  }

  private commit(tx: Tx, exclude?: WebSocket): void {
    const s = this.state!;
    s.lastActivity = tx.now;
    this.store.saveState(s);
    this.store.pruneEvents(s.seq - EVENT_LOG_LIMIT + 1);
    this.store.pruneActions(tx.now - ACTION_CACHE_MS);
    this.scheduleAlarm();
    if (tx.events.length) this.broadcast(tx.events, exclude);
  }

  private setPhase(tx: Tx, name: string, options: PhaseOptions = {}): void {
    const s = this.state!;
    s.phase = {
      id: s.phase.id + 1,
      name,
      startedAt: tx.now,
      deadline: options.durationMs ? tx.now + options.durationMs : null,
      requirement: options.requirement ? { ...options.requirement, done: [] } : null,
    };
    this.emit(tx, { type: "phase_changed", data: { phase: structuredClone(s.phase) } });
  }

  /** Advance while the current phase's requirement is satisfied. */
  private checkRequirement(tx: Tx): void {
    const s = this.state!;
    for (let guard = 0; guard < 16; guard++) {
      const { phase } = s;
      const req = phase.requirement;
      if (s.status !== "playing" || !s.game || !req) return;
      if (!req.actors.every((a) => req.done.includes(a))) return;
      GAMES[s.game.kind].onPhaseEnd(this.gameContext(tx), s.game.state, phase.name);
      if (s.phase.id === phase.id) return;
    }
  }

  private finishGame(tx: Tx): void {
    const s = this.state!;
    s.status = "finished";
    this.emit(tx, { type: "status_changed", data: { status: "finished" } });
    this.setPhase(tx, "finished");
  }

  /** Participant gives up their seat: removed outright, or kept as `left` while a game still references them. */
  private vacate(tx: Tx, userId: string, reason: "leave" | "timeout"): void {
    const s = this.state!;
    const p = s.participants[userId];
    if (!p) return;
    if (s.status === "lobby" || p.role === "observer") {
      this.removeParticipant(tx, userId, reason);
    } else {
      p.left = true;
      p.connected = false;
      p.disconnectedAt = null;
      this.emit(tx, { type: "participant_updated", data: { userId, changes: { left: true, connected: false } } });
      const req = s.phase.requirement;
      if (req?.actors.includes(userId)) {
        req.actors = req.actors.filter((a) => a !== userId);
        this.emit(tx, { type: "phase_changed", data: { phase: structuredClone(s.phase) } });
        this.checkRequirement(tx);
      }
    }
    if (s.hostId === userId) this.transferHost(tx);
  }

  private removeParticipant(tx: Tx, userId: string, reason: "leave" | "timeout" | "cleanup"): void {
    delete this.state!.participants[userId];
    this.emit(tx, { type: "participant_removed", data: { userId, reason } });
  }

  private transferHost(tx: Tx): void {
    const candidates = sortParticipants(Object.values(this.state!.participants).filter((p) => !p.left));
    const next = candidates.find((p) => p.role === "player") ?? candidates[0];
    this.setHost(tx, next?.userId ?? null);
  }

  private setHost(tx: Tx, hostId: string | null): void {
    if (this.state!.hostId === hostId) return;
    this.state!.hostId = hostId;
    this.emit(tx, { type: "host_changed", data: { hostId } });
  }

  private gameContext(tx: Tx): GameContext {
    return {
      now: tx.now,
      sessionId: this.state!.sessionId,
      emit: (body, secret) => this.emit(tx, body, secret),
      setPhase: (name, options) => this.setPhase(tx, name, options),
      activePlayers: () => this.activePlayers(),
      finish: () => this.finishGame(tx),
    };
  }

  private scheduleAlarm(): void {
    const s = this.state!;
    const times: number[] = [];
    if (s.phase.deadline !== null) times.push(s.phase.deadline);
    for (const p of Object.values(s.participants)) {
      if (!p.connected && !p.left && p.disconnectedAt !== null) times.push(p.disconnectedAt + DISCONNECT_GRACE_MS);
    }
    if (!this.hasLiveSocket()) times.push(s.lastActivity + IDLE_MS);
    if (times.length) void this.ctx.storage.setAlarm(Math.min(...times));
    else void this.ctx.storage.deleteAlarm();
  }

  private hasLiveSocket(): boolean {
    return this.ctx.getWebSockets().some((ws) => ws.readyState === WebSocket.OPEN);
  }

  // ---------------------------------------------------------------- Views

  private activePlayers(): string[] {
    return sortParticipants(Object.values(this.state!.participants))
      .filter((p) => p.role === "player" && !p.left)
      .map((p) => p.userId);
  }

  private playerCount(): number {
    return this.activePlayers().length;
  }

  private participantView(p: Participant): ParticipantView {
    return { userId: p.userId, name: p.name, role: p.role, joinedAt: p.joinedAt, connected: p.connected, left: p.left };
  }

  private snapshot(viewerId: string): SessionView {
    const s = this.state!;
    return {
      sessionId: s.sessionId,
      seq: s.seq,
      status: s.status,
      mode: s.mode,
      hostId: s.hostId,
      participants: sortParticipants(Object.values(s.participants).map((p) => this.participantView(p))),
      phase: structuredClone(s.phase),
      game: s.game ? GAMES[s.game.kind].project(s.game.state, viewerId) : null,
      messages: structuredClone(s.messages),
    };
  }

  /** Replay events after `lastSeq` when the log still covers them, otherwise send a full snapshot. */
  private sendSync(ws: WebSocket, userId: string, lastSeq: number | null): void {
    const s = this.state!;
    const minSeq = this.store.minSeq();
    const canReplay =
      lastSeq !== null && lastSeq >= 0 && lastSeq <= s.seq && (lastSeq === s.seq || (minSeq !== null && minSeq <= lastSeq + 1));
    this.send(ws, {
      t: "sync",
      serverTime: Date.now(),
      view: canReplay ? null : this.snapshot(userId),
      events: canReplay ? this.store.eventsAfter(lastSeq).map((e) => projectEvent(e, userId)) : [],
    });
  }

  private broadcast(events: RawEvent[], exclude?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const userId = (ws.deserializeAttachment() as Attachment | null)?.userId;
      if (!userId) continue;
      this.send(ws, { t: "events", events: events.map((e) => projectEvent(e, userId)) });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; the close handler takes care of presence.
    }
  }

  private reject(ws: WebSocket, code: number, reason: string): void {
    this.send(ws, { t: "error", code: reason, message: reason });
    ws.close(code, reason);
  }
}
