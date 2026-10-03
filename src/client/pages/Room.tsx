import { useState, type ReactNode } from "react";
import { HANDS, HAND_TEXT } from "../../shared/games/rps";
import type { Action, GameMode, Role } from "../../shared/protocol";
import type { Navigate } from "../App";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { Meeple } from "../components/Meeple";
import { ParticipantList } from "../components/ParticipantList";
import { TextPanel } from "../components/TextPanel";
import { loadIdentity, randomName, saveName, type Identity } from "../identity";
import { HAND_EMOJI, PHASE_LABEL, errorLabel } from "../labels";
import { useServerNow, useSession } from "../useSession";

interface Props {
  sessionId: string;
  role: Role;
  navigate: Navigate;
}

export function Room(props: Props) {
  const [identity, setIdentity] = useState(loadIdentity);
  const [name, setName] = useState("");
  const [placeholder] = useState(randomName);
  if (identity.name) return <RoomInner {...props} identity={identity} />;
  const displayName = name.trim() || placeholder;
  return (
    <main className="home">
      <h1>加入房間 {props.sessionId}</h1>
      <div className="avatar-preview">
        <Meeple name={displayName} size={48} />
      </div>
      <form
        className="row"
        style={{ justifyContent: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          setIdentity(saveName(displayName));
        }}
      >
        <input autoFocus value={name} maxLength={20} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
        <button className="primary" type="submit">
          加入
        </button>
      </form>
    </main>
  );
}

function Terminal({ message, children }: { message: string; children: ReactNode }) {
  return (
    <main>
      <h1>MeepleSync</h1>
      <p>{message}</p>
      <div className="row">{children}</div>
    </main>
  );
}


/* ── Collapsible participant drawer ────────────────── */

function ParticipantDrawer({
  view,
  meId,
  now,
  canChangeRole,
  onRoleChange,
}: {
  view: import("../../shared/protocol").SessionView;
  meId: string;
  now: number;
  canChangeRole: boolean;
  onRoleChange: (role: import("../../shared/protocol").Role) => void;
}) {
  const [open, setOpen] = useState(false);
  const me = view.participants.find((p) => p.userId === meId);
  const players = view.participants.filter((p) => p.role === "player" && !p.left);
  const observers = view.participants.filter((p) => p.role === "observer");
  const total = players.length + observers.length;
  const roleLabel = me ? (me.role === "player" ? "玩家" : "觀察者") : "";

  const { phase } = view;
  const remaining = phase.deadline === null ? null : Math.max(0, Math.ceil((phase.deadline - now) / 1000));
  const phaseLabel = view.status === "lobby" && view.mode === "text"
    ? "任意文字"
    : (PHASE_LABEL[phase.name] ?? phase.name);

  return (
    <div className="drawer">
      <button className="drawer-toggle" onClick={() => setOpen(!open)}>
        <span>
          <Meeple name={me?.name ?? "?"} size={16} />
          {" "}
          {roleLabel}
          <span className="muted"> · {total} 人在線</span>
          {remaining !== null && <span className="muted"> · 剩餘 {remaining}s</span>}
          <span className="muted"> · {phaseLabel}</span>
        </span>
        <span className="drawer-arrow">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="drawer-body">
          <ParticipantList view={view} meId={meId} canChangeRole={canChangeRole} onRoleChange={onRoleChange} />
        </div>
      )}
    </div>
  );
}

/* ── Main room view ────────────────────────────────── */

function RoomInner({ sessionId, role, navigate, identity }: Props & { identity: Identity }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useSession(sessionId, identity, role, attempt);
  const now = useServerNow(session.clockOffset);
  const home = <button onClick={() => navigate("/")}>回首頁</button>;
  const retry = (label: string) => <button onClick={() => setAttempt((n) => n + 1)}>{label}</button>;

  switch (session.status) {
    case "not_found":
      return <Terminal message="找不到這個房間，可能已經過期。">{home}</Terminal>;
    case "rejected":
      return <Terminal message={`無法加入：${errorLabel(session.lastError ?? "rejected")}`}>{home}</Terminal>;
    case "replaced":
      return (
        <Terminal message="你已在其他分頁開啟這個房間。">
          {retry("在此分頁繼續")}
          {home}
        </Terminal>
      );
    case "left":
      return (
        <Terminal message="你已離開房間。">
          {retry("重新加入")}
          {home}
        </Terminal>
      );
  }

  const { view } = session;
  const me = view?.participants.find((p) => p.userId === identity.userId);
  const isHost = !!view && view.hostId === identity.userId;
  const connected = session.status === "open";
  const req = view?.phase.requirement;
  const mustChoose =
    view?.game?.kind === "rps" &&
    req?.actionType === "text.post" &&
    req.actors.includes(identity.userId) &&
    !req.done.includes(identity.userId);
  const shareUrl = `${window.location.origin}/s/${sessionId}`;

  const run = async (action: Action) => {
    const ack = await session.act(action);
    setError(ack.ok ? null : errorLabel(ack.error ?? "action_failed"));
    return ack.ok;
  };

  // Whether the "開始" button should replace "送出"
  const inLobbyOrFinished = !!view && (view.status === "lobby" || view.status === "finished");
  const showStart = inLobbyOrFinished && isHost && view.mode !== "text";
  const playerCount = view ? view.participants.filter((p) => p.role === "player" && !p.left).length : 0;

  const handleStart = async () => {
    // If finished, restart first to return to lobby, then start
    if (view?.status === "finished") await run({ type: "restart" });
    void run({ type: "start" });
  };

  const handleModeChange = async (m: GameMode) => {
    if (view?.status === "finished") await run({ type: "restart" });
    void run({ type: "set_mode", mode: m });
  };

  return (
    <main className="room">
      {/* ── Top bar ── */}
      <header className="room-header">
        <span className="room-title">
          <strong>{sessionId}</strong>
        </span>
        <div className="row" style={{ gap: 4 }}>
          <button className="header-btn" onClick={() => navigator.clipboard.writeText(shareUrl)}>複製連結</button>
          <button className="header-btn danger-text" onClick={() => session.leave()}>離開房間</button>
        </div>
      </header>

      <ConnectionBanner status={session.status} />

      {view && (
        <>
          <ParticipantDrawer
            view={view}
            meId={identity.userId}
            now={now}
            canChangeRole={view.status === "lobby" && connected}
            onRoleChange={(role) => { void run({ type: "set_role", role }); }}
          />

          {error && <p className="error" style={{ margin: "4px 0", padding: "0 12px" }}>{error}</p>}

          <TextPanel
            sessionId={sessionId}
            messages={view.messages}
            meId={identity.userId}
            disabled={!connected || !me || me.left}
            options={mustChoose ? HANDS.map((h) => ({ text: HAND_TEXT[h], label: `${HAND_EMOJI[h]} ${HAND_TEXT[h]}` })) : null}
            onPost={(text) => run({ type: "text.post", text })}
            mode={view.mode}
            canChangeMode={isHost && inLobbyOrFinished && connected}
            onModeChange={(m: GameMode) => { void handleModeChange(m); }}
            showStart={showStart}
            startDisabled={playerCount < 2}
            onStart={() => { void handleStart(); }}
          />
        </>
      )}
    </main>
  );
}
