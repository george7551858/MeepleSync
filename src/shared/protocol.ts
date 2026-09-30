import type { Hand, RpsEventBody, RpsView } from "./games/rps";

export type Role = "player" | "observer";
export type SessionStatus = "lobby" | "playing" | "finished";

export interface ParticipantView {
  userId: string;
  name: string;
  role: Role;
  joinedAt: number;
  connected: boolean;
  /** Gave up their seat during a game (explicit leave or disconnect grace expired). */
  left: boolean;
}

export interface Requirement {
  actionType: string;
  actors: string[];
  done: string[];
}

export interface PhaseView {
  id: number;
  name: string;
  startedAt: number;
  /** Server epoch ms. */
  deadline: number | null;
  requirement: Requirement | null;
}

export type GameView = RpsView;

export interface SessionView {
  sessionId: string;
  seq: number;
  status: SessionStatus;
  hostId: string | null;
  participants: ParticipantView[];
  phase: PhaseView;
  game: GameView | null;
}

export type ParticipantChanges = Partial<Pick<ParticipantView, "name" | "role" | "connected" | "left">>;

export type EventBody =
  | { type: "participant_joined"; data: { participant: ParticipantView } }
  | { type: "participant_updated"; data: { userId: string; changes: ParticipantChanges } }
  | { type: "participant_removed"; data: { userId: string; reason: "leave" | "timeout" | "cleanup" } }
  | { type: "host_changed"; data: { hostId: string | null } }
  | { type: "status_changed"; data: { status: SessionStatus } }
  | { type: "phase_changed"; data: { phase: PhaseView } }
  | { type: "requirement_done"; data: { userId: string } }
  | { type: "game_set"; data: { game: GameView | null } }
  | RpsEventBody;

export type SessionEvent = EventBody & { seq: number; ts: number };

export type Action =
  | { type: "start"; rounds?: number }
  | { type: "restart" }
  | { type: "set_role"; role: Role }
  | { type: "rps.choose"; choice: Hand };

export type ClientMessage =
  | { t: "hello"; userId: string; secret: string; name: string; role: Role; lastSeq: number | null }
  | { t: "action"; actionId: string; phaseId: number; action: Action }
  | { t: "sync"; lastSeq: number | null }
  | { t: "leave" };

export type ServerMessage =
  /** `view` is present when the server could not replay events from `lastSeq`. */
  | { t: "sync"; serverTime: number; view: SessionView | null; events: SessionEvent[] }
  | { t: "events"; events: SessionEvent[] }
  | { t: "ack"; actionId: string; ok: boolean; error?: string }
  | { t: "error"; code: string; message: string };

export const CloseCode = {
  Left: 4000,
  Replaced: 4001,
  Rejected: 4003,
  NotFound: 4404,
} as const;

export const PING = "ping";
export const PONG = "pong";

export const SESSION_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const SESSION_ID_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;

export const NAME_MAX_LENGTH = 20;

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  return name || null;
}
