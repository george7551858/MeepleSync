import { env, exports } from "cloudflare:workers";
import type {
  Action,
  ClientMessage,
  GameMode,
  Role,
  ServerMessage,
  SessionEvent,
  SessionView,
} from "../src/shared/protocol";
import { applyEvent } from "../src/shared/view";

export async function createSession(mode: GameMode = "rps"): Promise<string> {
  const res = await exports.default.fetch("http://test/api/sessions", { method: "POST", body: JSON.stringify({ mode }) });
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

export function sessionStub(sessionId: string) {
  return env.SESSION.get(env.SESSION.idFromName(sessionId));
}

let counter = 0;
export function makeIdentity(name: string) {
  counter += 1;
  return { userId: `user-${counter}-${crypto.randomUUID()}`, secret: crypto.randomUUID() + crypto.randomUUID(), name };
}
export type Identity = ReturnType<typeof makeIdentity>;

/** Minimal client mirroring src/client/connection.ts: keeps a view from snapshot + events. */
export class TestClient {
  view: SessionView | null = null;
  received: SessionEvent[] = [];
  messages: ServerMessage[] = [];
  closeCode: number | null = null;
  private waiters: Array<() => void> = [];

  private constructor(
    readonly ws: WebSocket,
    readonly identity: Identity,
  ) {
    ws.addEventListener("message", (ev) => {
      if (ev.data === "pong") return;
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      this.messages.push(msg);
      if (msg.t === "sync") {
        if (msg.view) this.view = msg.view;
        this.applyAll(msg.events);
      } else if (msg.t === "events") {
        this.applyAll(msg.events);
      }
      this.notify();
    });
    ws.addEventListener("close", (ev) => {
      this.closeCode = ev.code;
      this.notify();
    });
  }

  static async connect(sessionId: string, identity: Identity, role: Role = "player", lastSeq: number | null = null) {
    const res = await exports.default.fetch(`http://test/api/sessions/${sessionId}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    const ws = res.webSocket!;
    ws.accept();
    const client = new TestClient(ws, identity);
    client.send({ t: "hello", ...identity, role, lastSeq });
    return client;
  }

  private applyAll(events: SessionEvent[]) {
    for (const e of events) {
      this.received.push(e);
      if (!this.view || e.seq <= this.view.seq) continue;
      if (e.seq !== this.view.seq + 1) throw new Error(`gap: have ${this.view.seq}, got ${e.seq}`);
      this.view = applyEvent(this.view, e);
    }
  }

  private notify() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error("waitFor timed out");
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  async ready() {
    return this.waitFor(() => this.view);
  }

  async act(action: Action, actionId: string = crypto.randomUUID(), phaseId = this.view!.phase.id) {
    this.send({ t: "action", actionId, phaseId, action });
    return this.waitFor(() => {
      const acks = this.messages.filter((m) => m.t === "ack" && m.actionId === actionId);
      return acks.length ? (acks[acks.length - 1] as Extract<ServerMessage, { t: "ack" }>) : undefined;
    });
  }

  async syncFresh(): Promise<SessionView> {
    const before = this.messages.length;
    this.send({ t: "sync", lastSeq: null });
    const msg = await this.waitFor(() => this.messages.slice(before).find((m) => m.t === "sync"));
    return (msg as Extract<ServerMessage, { t: "sync" }>).view!;
  }

  close() {
    this.ws.close(1000, "bye");
  }
}
