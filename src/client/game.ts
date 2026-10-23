import type { ComponentType } from "react";
import type { SessionView, TextMessage } from "../shared/protocol";

export type GameMessage = Extract<TextMessage, { kind: "game" }>;

export interface GameMessageProps {
  message: GameMessage;
  meId: string;
  sessionId: string;
}

export interface GamePanelProps {
  view: SessionView;
  meId: string;
}

/** Restricts the shared text input while the current phase is waiting on me. */
export interface GameInput {
  /** The only accepted texts. Each also becomes a quick-input button that sends exactly `text`. */
  options: { text: string; label: string }[];
  hint: string;
  placeholder: string;
}

/**
 * Client half of a game. Register it in `src/games/registry.client.ts`.
 * Games never add their own move buttons or panels that bypass the text input:
 * moves are texts, and `input().options` are just shortcuts for typing them.
 */
export interface ClientGame {
  /** Mode name shown in the mode picker. */
  label: string;
  /** Labels for the game's phase names (the core labels `lobby` and `finished`). */
  phaseLabels: Record<string, string>;
  /** Chinese labels for the game's own error codes. */
  errorLabels?: Record<string, string>;
  /** Called only when the current phase requirement is waiting on `meId`. null = free text. */
  input?(view: SessionView, meId: string): GameInput | null;
  /** Renders this game's messages in the text history. */
  Message: ComponentType<GameMessageProps>;
  /** Small read-only status shown above the input while the game is playing. */
  Panel?: ComponentType<GamePanelProps>;
}

export function participantName(view: SessionView, userId: string | null): string {
  return view.participants.find((p) => p.userId === userId)?.name ?? "?";
}
