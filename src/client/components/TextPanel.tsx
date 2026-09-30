import { useEffect, useRef, useState } from "react";
import { TEXT_MAX_LENGTH, type TextMessage } from "../../shared/protocol";
import { RpsResultMessage } from "./RpsPanel";

interface Props {
  sessionId: string;
  messages: TextMessage[];
  meId: string;
  disabled: boolean;
  /** When set, the current phase is waiting on me and only these texts are accepted. */
  options: { text: string; label: string }[] | null;
  onPost: (text: string) => Promise<boolean>;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Message({ sessionId, m, meId }: { sessionId: string; m: TextMessage; meId: string }) {
  if (m.kind === "rps_result") return <RpsResultMessage sessionId={sessionId} message={m} />;
  const who = <strong>{m.userId === meId ? `${m.name}（你）` : m.name}</strong>;
  if (m.kind === "text") {
    return (
      <>
        {who}：{m.text}
      </>
    );
  }
  return (
    <>
      {who}：已出拳 <span className="hash">#{m.commitment.slice(0, 12)}</span>
      {m.text && `（你出了 ${m.text}，已鎖定）`}
    </>
  );
}

export function TextPanel({ sessionId, messages, meId, disabled, options, onPost }: Props) {
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

  return (
    <section>
      <h2>文字</h2>
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
        <p className="muted">還沒有人輸入文字</p>
      )}
      {allowed && <p>出拳中：只能輸入 {allowed.join("、")}，送出後無法修改</p>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit(text);
        }}
      >
        <input
          className="grow"
          value={text}
          maxLength={TEXT_MAX_LENGTH}
          placeholder={allowed ? `輸入 ${allowed.join("、")}` : "輸入任意文字"}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" type="submit" disabled={disabled || !valid}>
          送出
        </button>
      </form>
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
    </section>
  );
}
