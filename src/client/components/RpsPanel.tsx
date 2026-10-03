import { HAND_TEXT } from "../../shared/games/rps";
import type { TextMessage } from "../../shared/protocol";
import { HAND_EMOJI } from "../labels";

export function RpsResultMessage({
  message,
}: {
  sessionId?: string;
  message: Extract<TextMessage, { kind: "rps_result" }>;
}) {
  const { result, names } = message;
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
