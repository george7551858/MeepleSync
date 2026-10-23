import type { ClientGame, GameMessageProps } from "../../client/game";
import { Author } from "../../client/components/Author";
import { HANDS, HAND_TEXT, parseHand, type Hand, type RpsCommitSecret, type RpsMessage } from "./shared";

export const HAND_EMOJI: Record<Hand, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

function RpsMessageView({ message, meId }: GameMessageProps) {
  const data = message.data as RpsMessage;
  if (data.type === "commit") {
    const text = (message.secret?.data as RpsCommitSecret | undefined)?.text;
    const hand = text ? parseHand(text) : null;
    const handDisplay = hand ? `${HAND_EMOJI[hand]} ${text}` : text;
    return (
      <>
        <Author name={data.name} isMe={data.userId === meId} />：已出招
        {text && `（你出了 ${handDisplay}，已鎖定）`}
      </>
    );
  }
  const { result, names } = data;
  return (
    <div>
      <strong>揭曉：</strong>
      {result.draw ? "平手" : `勝者 ${result.winners.map((w) => names[w]).join("、")}`}
      <ul className="plain indent">
        {Object.entries(result.picks).map(([userId, pick]) => (
          <li key={userId}>
            {names[userId]}：{pick ? `${HAND_EMOJI[pick.choice]} ${HAND_TEXT[pick.choice]}` : "未出招"}
            {result.winners.includes(userId) && " ★"}
          </li>
        ))}
      </ul>
    </div>
  );
}

const words = HANDS.map((h) => HAND_TEXT[h]).join("、");

export const rpsClient: ClientGame = {
  label: "猜拳",
  phaseLabels: { choosing: "出拳中", revealed: "揭曉" },
  errorLabels: {
    invalid_choice: "出拳中只能輸入 剪刀、石頭 或 布",
    already_committed: "已經提交過了",
  },
  input: () => ({
    options: HANDS.map((h) => ({ text: HAND_TEXT[h], label: `${HAND_EMOJI[h]} ${HAND_TEXT[h]}` })),
    hint: `出拳中：只能輸入 ${words}，送出後無法修改`,
    placeholder: `輸入 ${words}`,
  }),
  Message: RpsMessageView,
};
