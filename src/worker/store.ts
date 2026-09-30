import type { EventBody, PhaseView, SessionEvent, SessionStatus, ParticipantView } from "../shared/protocol";

export interface Participant extends ParticipantView {
  secretHash: string;
  disconnectedAt: number | null;
}

export interface SessionState {
  sessionId: string;
  createdAt: number;
  status: SessionStatus;
  hostId: string | null;
  seq: number;
  phase: PhaseView;
  participants: Record<string, Participant>;
  game: { kind: string; state: unknown } | null;
  lastActivity: number;
}

/** Data merged into the event payload only for the listed viewers. */
export interface EventSecret {
  to: string[];
  data: Record<string, unknown>;
}

export interface RawEvent {
  seq: number;
  ts: number;
  type: EventBody["type"];
  data: Record<string, unknown>;
  secret: EventSecret | null;
  actorId: string | null;
  actionId: string | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export function projectEvent(event: RawEvent, viewerId: string | null): SessionEvent {
  const reveal = event.secret && viewerId !== null && event.secret.to.includes(viewerId);
  const data = reveal ? { ...event.data, ...event.secret!.data } : event.data;
  return { seq: event.seq, ts: event.ts, type: event.type, data } as SessionEvent;
}

interface EventRow extends Record<string, SqlStorageValue> {
  seq: number;
  ts: number;
  type: string;
  data: string;
  secret: string | null;
  actor_id: string | null;
  action_id: string | null;
}

function rowToEvent(row: EventRow): RawEvent {
  return {
    seq: row.seq,
    ts: row.ts,
    type: row.type as RawEvent["type"],
    data: JSON.parse(row.data),
    secret: row.secret ? JSON.parse(row.secret) : null,
    actorId: row.actor_id,
    actionId: row.action_id,
  };
}

export class Store {
  constructor(private readonly sql: SqlStorage) {}

  /** Tables are created lazily so an uninitialized session never persists anything. */
  exists(): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'").toArray().length > 0;
  }

  migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        secret TEXT,
        actor_id TEXT,
        action_id TEXT
      );
      CREATE TABLE IF NOT EXISTS actions (
        action_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        result TEXT NOT NULL
      );
    `);
  }

  loadState(): SessionState | null {
    if (!this.exists()) return null;
    const rows = this.sql.exec<{ value: string }>("SELECT value FROM kv WHERE key = 'state'").toArray();
    return rows.length ? JSON.parse(rows[0].value) : null;
  }

  saveState(state: SessionState): void {
    this.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES ('state', ?)", JSON.stringify(state));
  }

  appendEvent(e: RawEvent): void {
    this.sql.exec(
      "INSERT INTO events (seq, ts, type, data, secret, actor_id, action_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      e.seq,
      e.ts,
      e.type,
      JSON.stringify(e.data),
      e.secret ? JSON.stringify(e.secret) : null,
      e.actorId,
      e.actionId,
    );
  }

  minSeq(): number | null {
    return this.sql.exec<{ m: number | null }>("SELECT MIN(seq) AS m FROM events").one().m;
  }

  eventsAfter(seq: number): RawEvent[] {
    return this.sql.exec<EventRow>("SELECT * FROM events WHERE seq > ? ORDER BY seq", seq).toArray().map(rowToEvent);
  }

  pruneEvents(keepFromSeq: number): void {
    this.sql.exec("DELETE FROM events WHERE seq < ?", keepFromSeq);
  }

  getAction(actionId: string): { userId: string; result: ActionResult } | null {
    const rows = this.sql
      .exec<{ user_id: string; result: string }>("SELECT user_id, result FROM actions WHERE action_id = ?", actionId)
      .toArray();
    return rows.length ? { userId: rows[0].user_id, result: JSON.parse(rows[0].result) } : null;
  }

  putAction(actionId: string, userId: string, ts: number, result: ActionResult): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO actions (action_id, user_id, ts, result) VALUES (?, ?, ?, ?)",
      actionId,
      userId,
      ts,
      JSON.stringify(result),
    );
  }

  pruneActions(before: number): void {
    this.sql.exec("DELETE FROM actions WHERE ts < ?", before);
  }
}
