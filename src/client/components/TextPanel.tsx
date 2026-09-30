import { useEffect, useRef, useState } from "react";
import { TEXT_MAX_LENGTH, type TextMessage } from "../../shared/protocol";

interface Props {
  messages: TextMessage[];
  meId: string;
  disabled: boolean;
  onPost: (text: string) => Promise<boolean>;
}

export function TextPanel({ messages, meId, disabled, onPost }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastId]);

  return (
    <section>
      <h2>文字</h2>
      {messages.length ? (
        <ul ref={listRef} className="plain messages">
          {messages.map((m) => (
            <li key={m.id}>
              <strong>{m.userId === meId ? `${m.name}（你）` : m.name}</strong>：{m.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">還沒有人輸入文字</p>
      )}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await onPost(text))) setText("");
        }}
      >
        <input
          className="grow"
          value={text}
          maxLength={TEXT_MAX_LENGTH}
          placeholder="輸入任意文字"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" type="submit" disabled={disabled || !text.trim()}>
          送出
        </button>
      </form>
    </section>
  );
}
