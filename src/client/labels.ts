import type { Hand } from "../shared/games/rps";
import type { GameMode } from "../shared/protocol";

export const HAND_EMOJI: Record<Hand, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

export const MODE_LABEL: Record<GameMode, string> = { text: "任意文字", rps: "猜拳" };

export const PHASE_LABEL: Record<string, string> = {
  lobby: "等待開始",
  choosing: "出拳中",
  revealed: "揭曉",
  finished: "已結束",
};

const ERROR_LABEL: Record<string, string> = {
  stale_phase: "階段已經改變，操作未送出",
  phase_expired: "時間已到",
  observer_cannot_act: "觀察者無法操作",
  host_only: "只有主持人可以這麼做",
  not_enough_players: "至少需要 2 位玩家",
  too_many_players: "玩家人數已滿",
  already_done: "已經提交過了",
  already_committed: "已經提交過了",
  not_your_turn: "目前不需要你操作",
  not_allowed_now: "現在不能這麼做",
  session_full: "房間人數已滿",
  identity_mismatch: "身份驗證失敗",
  invalid_text: "文字不能是空的，也不能超過 200 字",
  no_game: "任意文字模式沒有遊戲可以開始",
  invalid_choice: "出拳中只能輸入 剪刀、石頭 或 布",
  invalid_status: "狀態格式不正確",
};

export function errorLabel(code: string): string {
  return ERROR_LABEL[code] ?? code;
}
