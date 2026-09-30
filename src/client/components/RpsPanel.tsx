import { useEffect, useState } from "react";
import { HAND_TEXT, verifyCommitment, type RpsRoundResult, type RpsView } from "../../shared/games/rps";
import type { SessionView, TextMessage } from "../../shared/protocol";

function useVerified(sessionId: string, result: RpsRoundResult): Record<string, boolean> {
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      Object.entries(result.picks)
        .filter(([, pick]) => pick)
        .map(async ([userId, pick]) => {
          const commitment = result.commitments[userId];
          const ok = !!commitment && (await verifyCommitment(sessionId, result.round, userId, pick!, commitment));
          return [userId, ok] as const;
        }),
    ).then((entries) => !cancelled && setVerified(Object.fromEntries(entries)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, result]);
  return verified;
}

function ranking(scores: Record<string, number>): string[] {
  return Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
}

export function RpsResultMessage({
  sessionId,
  message,
}: {
  sessionId: string;
  message: Extract<TextMessage, { kind: "rps_result" }>;
}) {
  const { result, names, scores, final } = message;
  const verified = useVerified(sessionId, result);
  return (
    <div>
      <strong>第 {result.round} 回合揭曉：</strong>
      {result.draw ? "平手" : `勝者 ${result.winners.map((w) => names[w]).join("、")}`}
      <ul className="plain indent">
        {Object.entries(result.picks).map(([userId, pick]) => (
          <li key={userId}>
            {names[userId]}：{pick ? HAND_TEXT[pick.choice] : "未出拳"}
            {result.winners.includes(userId) && " ★"}
            {pick && (
              <span className="hash">
                {" "}
                {userId in verified ? (verified[userId] ? "✓ 與提交一致" : "✗ 與提交不符") : "驗證中…"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {final && (
        <div>
          <strong>最終計分：</strong>
          {ranking(scores)
            .map((id) => `${names[id]} ${scores[id]}`)
            .join("、")}
        </div>
      )}
    </div>
  );
}

export function RpsPanel({ view, game }: { view: SessionView; game: RpsView }) {
  const names: Record<string, string> = Object.fromEntries(view.participants.map((p) => [p.userId, p.name]));
  return (
    <section>
      <h2>
        猜拳 第 {game.round} / {game.totalRounds} 回合
      </h2>
      <table>
        <tbody>
          {ranking(game.scores).map((id) => (
            <tr key={id}>
              <td>{names[id] ?? "（已離開）"}</td>
              <td>{game.scores[id]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
