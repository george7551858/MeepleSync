import { useEffect, useRef, useState, type ReactNode } from "react";
import { GAME_MODES, SHARED_GAMES, isGameId, type GameId } from "../../games/registry";
import { CLIENT_GAMES } from "../../games/registry.client";
import { TEXT_MAX_LENGTH, type GameMode, type TextMessage } from "../../shared/protocol";
import type { GameInput } from "../game";
import { MODE_LABEL } from "../labels";
import { Author } from "./Author";

const GAME_IDS = Object.keys(SHARED_GAMES) as GameId[];

interface Props {
  sessionId: string;
  messages: TextMessage[];
  meId: string;
  disabled: boolean;
  /** When set, the current phase is waiting on me and only `input.options` texts are accepted. */
  input: GameInput | null;
  /** Game status shown above the input (the game's `Panel`), if any. */
  panel: ReactNode;
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
  if (m.kind === "text") {
    return (
      <>
        <Author name={m.name} isMe={m.userId === meId} />：{m.text}
      </>
    );
  }
  if (m.kind !== "game" || !isGameId(m.game)) return <span className="muted">（無法顯示的訊息）</span>;
  const GameMessage = CLIENT_GAMES[m.game].Message;
  return <GameMessage message={m} meId={meId} sessionId={sessionId} />;
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
              {MODE_LABEL[m]}
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
  input,
  panel,
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
  const options = input?.options;
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
              <div className={m.kind === "text" ? undefined : "game-block"}>
                <Message sessionId={sessionId} m={m} meId={meId} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="messages-empty">
          <span className="muted">還沒有人輸入文字</span>
          <div className="row empty-actions">
            {GAME_IDS.map((g) => (
              <button
                key={g}
                type="button"
                className={mode === g ? "primary" : ""}
                disabled={!canChangeMode}
                onClick={() => onModeChange(g)}
              >
                {MODE_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      )}
      {panel}
      {input && <p className="chat-hint">{input.hint}</p>}
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
              placeholder={input ? input.placeholder : "輸入訊息…"}
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
