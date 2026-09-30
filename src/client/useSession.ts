import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Role } from "../shared/protocol";
import { SessionConnection } from "./connection";
import type { Identity } from "./identity";

export function useSession(sessionId: string, identity: Identity, role: Role, attempt: number) {
  // `attempt` lets the UI force a brand-new connection (e.g. after "replaced" or "left").
  const conn = useMemo(
    () => new SessionConnection(sessionId, identity, role),
    [sessionId, identity, role, attempt],
  );
  useEffect(() => {
    conn.start();
    return () => conn.stop();
  }, [conn]);
  const snapshot = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  return { ...snapshot, act: conn.act.bind(conn), leave: conn.leave.bind(conn) };
}

/** Current server time, ticking every `intervalMs`. */
export function useServerNow(clockOffset: number, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    setNow(Date.now() + clockOffset);
    const timer = setInterval(() => setNow(Date.now() + clockOffset), intervalMs);
    return () => clearInterval(timer);
  }, [clockOffset, intervalMs]);
  return now;
}
