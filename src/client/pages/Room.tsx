import { useState, type ReactNode } from "react";
import { GAME_MODES, type Action, type GameMode, type Role } from "../../shared/protocol";
import type { Navigate } from "../App";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ParticipantList } from "../components/ParticipantList";
import { PhaseBar } from "../components/PhaseBar";
import { RpsPanel } from "../components/RpsPanel";
import { TextPanel } from "../components/TextPanel";
import { loadIdentity, saveName, type Identity } from "../identity";
import { MODE_LABEL, errorLabel } from "../labels";
import { useServerNow, useSession } from "../useSession";

interface Props {
  sessionId: string;
  role: Role;
  navigate: Navigate;
}

export function Room(props: Props) {
  const [identity, setIdentity] = useState(loadIdentity);
  const [name, setName] = useState("");
  if (identity.name) return <RoomInner {...props} identity={identity} />;
  return (
    <main>
      <h1>加入房間 {props.sessionId}</h1>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setIdentity(saveName(name));
        }}
      >
        <input autoFocus value={name} maxLength={20} placeholder="你的名字" onChange={(e) => setName(e.target.value)} />
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

function RoomInner({ sessionId, role, navigate, identity }: Props & { identity: Identity }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState(3);
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
  const shareUrl = `${window.location.origin}/s/${sessionId}`;

  const run = async (action: Action) => {
    const ack = await session.act(action);
    setError(ack.ok ? null : errorLabel(ack.error ?? "action_failed"));
    return ack.ok;
  };

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>房間 {sessionId}</h1>
        <div className="row">
          <button onClick={() => navigator.clipboard.writeText(shareUrl)}>複製連結</button>
          <button onClick={() => session.leave()}>離開</button>
        </div>
      </div>

      <ConnectionBanner status={session.status} />

      {view && (
        <>
          <PhaseBar view={view} me={me} now={now} />
          {error && <p className="error">{error}</p>}
          <ParticipantList view={view} meId={identity.userId} />

          {view.status === "lobby" && me && (
            <section>
              <h2>準備</h2>
              <div className="row">
                <button
                  disabled={!connected}
                  onClick={() => run({ type: "set_role", role: me.role === "player" ? "observer" : "player" })}
                >
                  {me.role === "player" ? "改為觀察者" : "改為玩家"}
                </button>
                {isHost ? (
                  <select
                    value={view.mode}
                    disabled={!connected}
                    onChange={(e) => run({ type: "set_mode", mode: e.target.value as GameMode })}
                  >
                    {GAME_MODES.map((m) => (
                      <option key={m} value={m}>
                        模式：{MODE_LABEL[m]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>模式：{MODE_LABEL[view.mode]}</span>
                )}
                {isHost && view.mode === "rps" && (
                  <>
                    <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
                      {[1, 3, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} 回合
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary"
                      disabled={!connected || view.participants.filter((p) => p.role === "player").length < 2}
                      onClick={() => run({ type: "start", rounds })}
                    >
                      開始猜拳
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {view.game?.kind === "rps" && (
            <RpsPanel
              view={view}
              game={view.game}
              meId={identity.userId}
              onChoose={(choice) => connected && run({ type: "rps.choose", choice })}
            />
          )}

          {view.status === "finished" && isHost && (
            <section>
              <button className="primary" disabled={!connected} onClick={() => run({ type: "restart" })}>
                再玩一次
              </button>
            </section>
          )}

          <TextPanel
            messages={view.messages}
            meId={identity.userId}
            disabled={!connected || !me || me.left}
            onPost={(text) => run({ type: "text.post", text })}
          />
        </>
      )}
    </main>
  );
}
