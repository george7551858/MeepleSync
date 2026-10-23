import { CLIENT_GAMES } from "../games/registry.client";
import { GAME_MODES, isGameId } from "../games/registry";
import type { GameMode, SessionView } from "../shared/protocol";

export const MODE_LABEL = Object.fromEntries(
  GAME_MODES.map((m) => [m, m === "text" ? "任意文字" : CLIENT_GAMES[m].label]),
) as Record<GameMode, string>;

const PHASE_LABEL: Record<string, string> = {
  lobby: "等待開始",
  finished: "已結束",
};

export function phaseLabel(view: SessionView): string {
  if (view.status === "lobby" && view.mode === "text") return "任意文字";
  const name = view.phase.name;
  const game = isGameId(view.mode) ? CLIENT_GAMES[view.mode] : null;
  return PHASE_LABEL[name] ?? game?.phaseLabels[name] ?? name;
}

const ERROR_LABEL: Record<string, string> = {
  stale_phase: "階段已經改變，操作未送出",
  phase_expired: "時間已到",
  observer_cannot_act: "觀察者無法操作",
  host_only: "只有主持人可以這麼做",
  not_enough_players: "玩家人數不足",
  too_many_players: "玩家人數已滿",
  already_done: "已經提交過了",
  not_your_turn: "目前不需要你操作",
  not_allowed_now: "現在不能這麼做",
  session_full: "房間人數已滿",
  identity_mismatch: "身份驗證失敗",
  invalid_text: "文字不能是空的，也不能超過 200 字",
  no_game: "任意文字模式沒有遊戲可以開始",
  invalid_status: "狀態格式不正確",
};

export function errorLabel(code: string): string {
  if (ERROR_LABEL[code]) return ERROR_LABEL[code];
  for (const game of Object.values(CLIENT_GAMES)) {
    const label = game.errorLabels?.[code];
    if (label) return label;
  }
  return code;
}
