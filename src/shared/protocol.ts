import type { RpsEventBody, RpsRoundResult, RpsView } from "./games/rps";

export type Role = "player" | "observer";
export type SessionStatus = "lobby" | "playing" | "finished";
/** `text` applies no game rules; other modes name the game the host can start. */
export type GameMode = "text" | "rps";
export const GAME_MODES: readonly GameMode[] = ["text", "rps"];

export type MessageBody =
  | { kind: "text"; userId: string; name: string; text: string }
  /** A submission hidden until reveal; `text` is present only for its author. */
  | { kind: "commit"; userId: string; name: string; commitment: string; text?: string }
  | {
      kind: "rps_result";
      result: RpsRoundResult;
      names: Record<string, string>;
      scores: Record<string, number>;
      final: boolean;
    };

/** `id` equals the seq of the `text_posted` event that created it. */
export type TextMessage = { id: number; ts: number } & MessageBody;

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
  mode: GameMode;
  hostId: string | null;
  participants: ParticipantView[];
  phase: PhaseView;
  game: GameView | null;
  /** The most recent MESSAGE_HISTORY messages. */
  messages: TextMessage[];
}

export type ParticipantChanges = Partial<Pick<ParticipantView, "name" | "role" | "connected" | "left">>;

export type EventBody =
  | { type: "participant_joined"; data: { participant: ParticipantView } }
  | { type: "participant_updated"; data: { userId: string; changes: ParticipantChanges } }
  | { type: "participant_removed"; data: { userId: string; reason: "leave" | "timeout" | "cleanup" } }
  | { type: "host_changed"; data: { hostId: string | null } }
  | { type: "status_changed"; data: { status: SessionStatus } }
  | { type: "mode_changed"; data: { mode: GameMode } }
  | { type: "text_posted"; data: { message: TextMessage } }
  | { type: "phase_changed"; data: { phase: PhaseView } }
  | { type: "requirement_done"; data: { userId: string } }
  | { type: "game_set"; data: { game: GameView | null } }
  | RpsEventBody;

export type SessionEvent = EventBody & { seq: number; ts: number };

export type Action =
  | { type: "start" }
  | { type: "restart" }
  | { type: "set_role"; role: Role }
  | { type: "set_mode"; mode: GameMode }
  | { type: "text.post"; text: string };

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

export const TEXT_MAX_LENGTH = 200;
export const MESSAGE_HISTORY = 50;

/** Returns null for empty or over-long text. */
export function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text && text.length <= TEXT_MAX_LENGTH ? text : null;
}

export function isGameMode(value: unknown): value is GameMode {
  return (GAME_MODES as readonly unknown[]).includes(value);
}
