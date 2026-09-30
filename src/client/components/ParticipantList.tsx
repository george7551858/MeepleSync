import type { ParticipantView, SessionView } from "../../shared/protocol";

function Row({ p, view, meId }: { p: ParticipantView; view: SessionView; meId: string }) {
  const req = view.phase.requirement;
  const status = p.left ? "已離開" : p.connected ? "" : "斷線中";
  return (
    <li>
      <span className={p.connected ? "dot-on" : "dot-off"}>●</span>{" "}
      <span className={p.left ? "gone" : ""}>{p.name}</span>
      {p.userId === meId && " (你)"}
      {view.hostId === p.userId && " [主持]"}
      {status && <span className="muted"> {status}</span>}
      {req?.actors.includes(p.userId) && (
        <span className="muted"> {req.done.includes(p.userId) ? "✓ 已完成" : "… 等待中"}</span>
      )}
    </li>
  );
}

export function ParticipantList({ view, meId }: { view: SessionView; meId: string }) {
  const players = view.participants.filter((p) => p.role === "player");
  const observers = view.participants.filter((p) => p.role === "observer");
  return (
    <section>
      <h2>玩家（{players.filter((p) => !p.left).length}）</h2>
      <ul className="plain">
        {players.map((p) => (
          <Row key={p.userId} p={p} view={view} meId={meId} />
        ))}
      </ul>
      {observers.length > 0 && (
        <>
          <h2>觀察者（{observers.length}）</h2>
          <ul className="plain">
            {observers.map((p) => (
              <Row key={p.userId} p={p} view={view} meId={meId} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
