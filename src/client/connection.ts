import {
  CloseCode,
  PING,
  PONG,
  type Action,
  type ClientMessage,
  type Role,
  type ServerMessage,
  type SessionEvent,
  type SessionView,
} from "../shared/protocol";
import { applyEvent } from "../shared/view";
import type { Identity } from "./identity";

export type ConnStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "offline"
  | "replaced"
  | "left"
  | "not_found"
  | "rejected";

export interface ConnSnapshot {
  view: SessionView | null;
  status: ConnStatus;
  /** serverTime - localTime, in ms. */
  clockOffset: number;
  lastError: string | null;
}

export interface Ack {
  ok: boolean;
  error?: string;
}

const HEARTBEAT_MS = 10_000;
const DEAD_AFTER_MS = 25_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 10_000;

const TERMINAL: Record<number, ConnStatus> = {
  [CloseCode.Left]: "left",
  [CloseCode.Replaced]: "replaced",
  [CloseCode.Rejected]: "rejected",
  [CloseCode.NotFound]: "not_found",
};

/**
 * One WebSocket session with automatic reconnect. The view is only ever derived from
 * server snapshots plus strictly consecutive events; any gap triggers a resync.
 */
export class SessionConnection {
  private snapshot: ConnSnapshot = { view: null, status: "connecting", clockOffset: 0, lastError: null };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = true;
  private syncing = false;
  private resendPending = false;
  private lastMessageAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Unacknowledged actions, resent after reconnect; the server dedupes by actionId. */
  private pending = new Map<string, { msg: ClientMessage; resolve: (ack: Ack) => void }>();

  constructor(
    private readonly sessionId: string,
    private readonly identity: Identity,
    private readonly role: Role,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    this.heartbeat = setInterval(this.tick, HEARTBEAT_MS);
    this.open();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.ws?.close(1000, "client stop");
    this.ws = null;
  }

  act(action: Action): Promise<Ack> {
    const view = this.snapshot.view;
    if (!view) return Promise.resolve({ ok: false, error: "not_ready" });
    const actionId = crypto.randomUUID();
    const msg: ClientMessage = { t: "action", actionId, phaseId: view.phase.id, action };
    return new Promise((resolve) => {
      this.pending.set(actionId, { msg, resolve });
      this.send(msg);
    });
  }

  leave() {
    this.send({ t: "leave" });
  }

  private update(patch: Partial<ConnSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/sessions/${this.sessionId}/ws`);
    this.ws = ws;
    this.syncing = true;
    this.resendPending = true;
    ws.onopen = () => {
      this.lastMessageAt = Date.now();
      const { userId, secret, name } = this.identity;
      this.send({ t: "hello", userId, secret, name, role: this.role, lastSeq: this.snapshot.view?.seq ?? null });
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      if (ev.data === PONG) return;
      this.onMessage(JSON.parse(ev.data) as ServerMessage);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const terminal = TERMINAL[ev.code];
      if (terminal) {
        this.stop();
        this.update({ status: terminal });
        return;
      }
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    this.update({ status: navigator.onLine ? "reconnecting" : "offline" });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private onOnline = () => {
    if (this.stopped || this.ws) return;
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.open();
  };

  private tick = () => {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastMessageAt > DEAD_AFTER_MS) {
      // Half-open connection: force the close path so we reconnect.
      const ws = this.ws;
      this.ws = null;
      ws.close();
      this.scheduleReconnect();
      return;
    }
    this.ws.send(PING);
  };

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case "sync": {
        this.syncing = false;
        const view = msg.view ?? this.snapshot.view;
        this.update({ view, clockOffset: msg.serverTime - Date.now() });
        this.applyEvents(msg.events);
        if (this.snapshot.status !== "open") {
          this.attempt = 0;
          this.update({ status: "open", lastError: null });
        }
        if (this.resendPending) {
          this.resendPending = false;
          this.pending.forEach(({ msg: pendingMsg }) => this.send(pendingMsg));
        }
        break;
      }
      case "events":
        this.applyEvents(msg.events);
        break;
      case "ack": {
        const entry = this.pending.get(msg.actionId);
        this.pending.delete(msg.actionId);
        entry?.resolve({ ok: msg.ok, error: msg.error });
        if (!msg.ok) this.update({ lastError: msg.error ?? "action_failed" });
        break;
      }
      case "error":
        this.update({ lastError: msg.code });
        break;
    }
  }

  private applyEvents(events: SessionEvent[]) {
    let view = this.snapshot.view;
    if (!view || this.syncing) return;
    for (const event of events) {
      if (event.seq <= view.seq) continue;
      if (event.seq !== view.seq + 1) {
        this.syncing = true;
        this.send({ t: "sync", lastSeq: view.seq });
        break;
      }
      view = applyEvent(view, event);
    }
    if (view !== this.snapshot.view) this.update({ view });
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
