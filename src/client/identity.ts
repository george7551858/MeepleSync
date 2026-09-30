import { normalizeName } from "../shared/protocol";

export interface Identity {
  userId: string;
  secret: string;
  name: string;
}

const KEY = "meeplesync.identity";

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadIdentity(): Identity {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Identity | null;
    if (stored?.userId && stored.secret) return { ...stored, name: stored.name ?? "" };
  } catch {
    // Corrupted storage: fall through and mint a new identity.
  }
  const identity = { userId: crypto.randomUUID(), secret: randomHex(32), name: "" };
  localStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}

export function saveName(raw: string): Identity {
  const identity = { ...loadIdentity(), name: normalizeName(raw) ?? "" };
  localStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}
