import { useEffect, useRef, useState } from "react";
import { parseHand } from "../../shared/games/rps";
import { GAME_MODES, TEXT_MAX_LENGTH, type GameMode, type TextMessage } from "../../shared/protocol";
import { HAND_EMOJI, MODE_LABEL } from "../labels";
import { Meeple } from "./Meeple";
import { RpsResultMessage } from "./RpsPanel";

interface Props {
  sessionId: string;
  messages: TextMessage[];
  meId: string;
  disabled: boolean;
  /** When set, the current phase is waiting on me and only these texts are accepted. */
  options: { text: string; label: string }[] | null;
  onPost: (text: string) => Promise<boolean>;

  /** Current room mode. */
  mode: GameMode;
  /** Whether mode can be changed (host + lobby). */
  canChangeMode: boolean;
  onModeChange: (mode: GameMode) => void;

  /** Show "開始" instead of "送出" (host + lobby + game mode). */
  showStart: boolean;
  /** Whether the start button should be disabled (e.g. not enough players). */
  startDisabled: boolean;
  onStart: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Message({ sessionId, m, meId }: { sessionId: string; m: TextMessage; meId: string }) {
  if (m.kind === "rps_result") return <RpsResultMessage sessionId={sessionId} message={m} />;
  const who = (
    <span className="msg-author">
      <Meeple name={m.name} size={14} /> <strong>{m.userId === meId ? `${m.name}（你）` : m.name}</strong>
    </span>
  );
  if (m.kind === "text") {
    return (
      <>
        {who}：{m.text}
      </>
    );
  }
  const hand = m.text ? parseHand(m.text) : null;
  const handDisplay = hand ? `${HAND_EMOJI[hand]} ${m.text}` : m.text;
  return (
    <>
      {who}：已出招
      {m.text && `（你出了 ${handDisplay}，已鎖定）`}
    </>
  );
}

/* ── Mode picker (left of input) ───────────────────── */

function ModePicker({
  mode,
  canChange,
  onChange,
}: {
  mode: GameMode;
  canChange: boolean;
  onChange: (m: GameMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const onBlur = (e: React.FocusEvent) => {
    if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <div className="mode-anchor" ref={ref} onBlur={onBlur}>
      <button
        type="button"
        className="mode-btn"
        disabled={!canChange}
        onClick={() => setOpen(!open)}
        title={canChange ? "切換模式" : MODE_LABEL[mode]}
      >
        {MODE_LABEL[mode]} {canChange && "▾"}
      </button>
      {open && canChange && (
        <div className="mode-dropdown">
          {GAME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "active" : ""}
              onClick={() => { onChange(m); setOpen(false); }}
            >
              {m === mode ? "✓ " : ""}{MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main panel ────────────────────────────────────── */

export function TextPanel({
  sessionId,
  messages,
  meId,
  disabled,
  options,
  onPost,
  mode,
  canChangeMode,
  onModeChange,
  showStart,
  startDisabled,
  onStart,
}: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const lastId = messages.at(-1)?.id;
  const allowed = options?.map((o) => o.text);
  const valid = allowed ? allowed.includes(text.trim()) : !!text.trim();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastId]);

  const submit = async (value: string) => {
    if (await onPost(value)) setText("");
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showStart) {
      onStart();
    } else if (valid) {
      void submit(text);
    }
  };

  return (
    <section className="chat-area">
      {messages.length ? (
        <ul ref={listRef} className="plain messages">
          {messages.map((m) => (
            <li key={m.id}>
              <time className="time">{formatTime(m.ts)}</time>
              <div className={m.kind === "text" ? undefined : "rps-block"}>
                <Message sessionId={sessionId} m={m} meId={meId} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="messages-empty">
          <span className="muted">還沒有人輸入文字</span>
        </div>
      )}
      {allowed && <p className="chat-hint">出拳中：只能輸入 {allowed.join("、")}，送出後無法修改</p>}
      {options && (
        <div className="row quick">
          {options.map((o) => (
            <button
              key={o.text}
              className="emoji"
              title={o.text}
              aria-label={o.text}
              disabled={disabled}
              onClick={() => void submit(o.text)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <form className="chat-input" onSubmit={handleFormSubmit}>
        <ModePicker mode={mode} canChange={canChangeMode} onChange={onModeChange} />
        {showStart ? (
          <>
            <span className="grow chat-start-hint muted">人齊後點開始</span>
            <button className="primary" type="submit" disabled={disabled || startDisabled}>
              開始
            </button>
          </>
        ) : (
          <>
            <input
              className="grow"
              value={text}
              maxLength={TEXT_MAX_LENGTH}
              placeholder={allowed ? `輸入 ${allowed.join("、")}` : "輸入訊息…"}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="primary" type="submit" disabled={disabled || !valid}>
              送出
            </button>
          </>
        )}
      </form>
    </section>
  );
}
