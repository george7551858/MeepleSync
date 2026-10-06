import { useEffect, useState } from "react";
import { STATUS_MAX_LENGTH, type ParticipantView, type Role, type SessionView } from "../../shared/protocol";
import { HIGHLIGHTER_PRESETS, applyColorToStatus, parseStatus } from "../nameColor";
import { Meeple } from "./Meeple";

interface Props {
  view: SessionView;
  meId: string;
  /** Whether the current user can switch roles (lobby only). */
  canChangeRole: boolean;
  onRoleChange: (role: Role) => void;
  onStatusChange: (status: string) => void;
}

function Row({ p, view, meId }: { p: ParticipantView; view: SessionView; meId: string }) {
  const req = view.phase.requirement;
  const status = p.left ? "已離開" : p.connected ? "" : "斷線中";
  const { color: underlineColor, text: statusText } = parseStatus(p.status);
  return (
    <li className="participant-row">
      <Meeple name={p.name} size={20} />
      <span
        className={p.left ? "gone" : ""}
        style={
          underlineColor
            ? {
                textDecoration: "underline",
                textDecorationColor: underlineColor,
                textDecorationThickness: "3px",
                textUnderlineOffset: "3px",
              }
            : undefined
        }
      >
        {p.name}
      </span>
      {p.userId === meId && " (你)"}
      {view.hostId === p.userId && " [主持]"}
      {statusText && <span className="muted participant-status-tag"> · {statusText}</span>}
      {status && <span className="muted"> {status}</span>}
      {req?.actors.includes(p.userId) && (
        <span className="muted"> {req.done.includes(p.userId) ? "✓ 已完成" : "… 等待中"}</span>
      )}
    </li>
  );
}

function StatusEditor({
  currentStatus,
  onStatusChange,
}: {
  currentStatus: string;
  onStatusChange: (status: string) => void;
}) {
  const [text, setText] = useState(currentStatus);
  const { color: currentColor } = parseStatus(currentStatus);

  useEffect(() => {
    setText(currentStatus);
  }, [currentStatus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStatusChange(text.trim());
  };

  const handlePresetClick = (presetCode: string) => {
    const next = applyColorToStatus(text, presetCode);
    setText(next);
    onStatusChange(next);
  };

  return (
    <div className="status-editor">
      <div className="status-presets">
        <span className="status-label">狀態：</span>
        {HIGHLIGHTER_PRESETS.map((c) => (
          <button
            key={c.code}
            type="button"
            className={`preset-swatch ${currentColor?.toLowerCase() === c.code.toLowerCase() ? "active" : ""}`}
            style={{ backgroundColor: c.code }}
            title={`${c.label} (${c.code})`}
            aria-label={c.label}
            onClick={() => handlePresetClick(c.code)}
          />
        ))}
      </div>
      <form className="status-form" onSubmit={handleSubmit}>
        <input
          className="status-input"
          value={text}
          maxLength={STATUS_MAX_LENGTH}
          placeholder="例如：#54ff6e 沉思"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={text.trim() === currentStatus}>
          更新
        </button>
        {currentStatus && (
          <button
            type="button"
            className="status-clear-btn"
            title="清除狀態"
            onClick={() => {
              setText("");
              onStatusChange("");
            }}
          >
            清除
          </button>
        )}
      </form>
    </div>
  );
}

export function ParticipantList({ view, meId, canChangeRole, onRoleChange, onStatusChange }: Props) {
  const me = view.participants.find((p) => p.userId === meId);
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
      {me && !me.left && (
        <StatusEditor
          currentStatus={me.status ?? ""}
          onStatusChange={onStatusChange}
        />
      )}
      {canChangeRole && me && (
        <button
          className="role-switch-btn"
          onClick={() => onRoleChange(me.role === "player" ? "observer" : "player")}
        >
          {me.role === "player" ? "改為觀察者" : "改為玩家"}
        </button>
      )}
    </section>
  );
}
