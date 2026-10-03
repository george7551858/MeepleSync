import { normalizeName } from "../shared/protocol";

export interface Identity {
  userId: string;
  secret: string;
  name: string;
}

const KEY = "meeplesync.identity";

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ADJ = [
  "快樂", "勇敢", "神秘", "迷你", "飛行", "暴走", "沉默", "閃亮",
  "搖滾", "優雅", "狂野", "淘氣", "慵懶", "認真", "帥氣", "冷靜",
];
const NOUN = [
  "米寶", "騎士", "巫師", "龍", "海盜", "忍者", "貓咪", "企鵝",
  "熊貓", "狐狸", "章魚", "浣熊", "獨角獸", "機器人", "刺蝟", "水獺",
];

function pick<T>(arr: readonly T[]): T {
  return arr[crypto.getRandomValues(new Uint8Array(1))[0] % arr.length];
}

/** Generate a random Traditional-Chinese display name like "快樂米寶". */
export function randomName(): string {
  return pick(ADJ) + pick(NOUN);
}

export function loadIdentity(): Identity {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Identity | null;
    if (stored?.userId && stored.secret) return { ...stored, name: stored.name ?? "" };
  } catch {
    // Corrupted storage: fall through and mint a new identity.
  }
  const identity = { userId: randomHex(16), secret: randomHex(32), name: "" };
  localStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}

export function saveName(raw: string): Identity {
  const identity = { ...loadIdentity(), name: normalizeName(raw) ?? "" };
  localStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}
