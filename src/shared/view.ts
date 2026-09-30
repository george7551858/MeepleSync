import { applyRpsEvent } from "./games/rps";
import { MESSAGE_HISTORY, type ParticipantView, type SessionEvent, type SessionView, type TextMessage } from "./protocol";

/** Appends in place, keeping only the most recent MESSAGE_HISTORY entries. */
export function pushMessage(messages: TextMessage[], message: TextMessage): void {
  messages.push(message);
  if (messages.length > MESSAGE_HISTORY) messages.splice(0, messages.length - MESSAGE_HISTORY);
}

export function sortParticipants(list: ParticipantView[]): ParticipantView[] {
  return list.sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
}

/** Pure reducer: returns a new view with `event` applied. Caller guarantees `event.seq === view.seq + 1`. */
export function applyEvent(view: SessionView, event: SessionEvent): SessionView {
  const v = structuredClone(view);
  v.seq = event.seq;
  switch (event.type) {
    case "participant_joined":
      v.participants.push(event.data.participant);
      sortParticipants(v.participants);
      break;
    case "participant_updated": {
      const p = v.participants.find((x) => x.userId === event.data.userId);
      if (p) Object.assign(p, event.data.changes);
      break;
    }
    case "participant_removed":
      v.participants = v.participants.filter((x) => x.userId !== event.data.userId);
      break;
    case "host_changed":
      v.hostId = event.data.hostId;
      break;
    case "status_changed":
      v.status = event.data.status;
      break;
    case "mode_changed":
      v.mode = event.data.mode;
      break;
    case "text_posted":
      pushMessage(v.messages, event.data.message);
      break;
    case "phase_changed":
      v.phase = event.data.phase;
      break;
    case "requirement_done":
      v.phase.requirement?.done.push(event.data.userId);
      break;
    case "game_set":
      v.game = event.data.game;
      break;
    case "rps_round_started":
    case "rps_revealed":
      if (v.game?.kind === "rps") applyRpsEvent(v.game, event);
      break;
  }
  return v;
}
