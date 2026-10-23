import { Meeple } from "./Meeple";

/** Avatar plus name of a message author, marking the current user. */
export function Author({ name, isMe }: { name: string; isMe: boolean }) {
  return (
    <span className="msg-author">
      <Meeple name={name} size={18} /> <strong>{isMe ? `${name}（你）` : name}</strong>
    </span>
  );
}
