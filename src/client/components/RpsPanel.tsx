import { useEffect, useState } from "react";
import { HANDS, verifyCommitment, type Hand, type RpsRoundResult, type RpsView } from "../../shared/games/rps";
import type { SessionView } from "../../shared/protocol";
import { HAND_LABEL } from "../labels";

type Names = Record<string, string>;

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

function RoundResult({ sessionId, result, names }: { sessionId: string; result: RpsRoundResult; names: Names }) {
  const verified = useVerified(sessionId, result);
  return (
    <div>
      <div>
        第 {result.round} 回合：{result.draw ? "平手" : `勝者 ${result.winners.map((w) => names[w]).join("、")}`}
      </div>
      <ul className="plain">
        {Object.entries(result.picks).map(([userId, pick]) => (
          <li key={userId}>
            {names[userId]}：{pick ? HAND_LABEL[pick.choice] : "未出拳"}
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
    </div>
  );
}

interface Props {
  view: SessionView;
  game: RpsView;
  meId: string;
  onChoose: (choice: Hand) => void;
}

export function RpsPanel({ view, game, meId, onChoose }: Props) {
  const names: Names = Object.fromEntries(view.participants.map((p) => [p.userId, p.name]));
  for (const id of game.players) names[id] ??= "（已離開）";
  const req = view.phase.requirement;
  const canChoose = view.phase.name === "choosing" && !!req?.actors.includes(meId) && !req.done.includes(meId);
  const latest = game.history[game.history.length - 1];
  const showLatest = latest && view.phase.name !== "choosing";
  const ranking = [...game.players].sort((a, b) => game.scores[b] - game.scores[a]);

  return (
    <section>
      <h2>
        猜拳 第 {game.round} / {game.totalRounds} 回合
      </h2>

      {view.phase.name === "choosing" && (
        <>
          {canChoose && (
            <div className="row">
              {HANDS.map((h) => (
                <button key={h} className="primary" onClick={() => onChoose(h)}>
                  {HAND_LABEL[h]}
                </button>
              ))}
            </div>
          )}
          {game.myChoice && <p>你出了：{HAND_LABEL[game.myChoice]}（已鎖定，無法修改）</p>}
          <ul className="plain">
            {game.players.map((id) => (
              <li key={id}>
                {names[id]}：
                {game.commitments[id] ? (
                  <>
                    已提交 <span className="hash">#{game.commitments[id].slice(0, 12)}</span>
                  </>
                ) : (
                  <span className="muted">尚未提交</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {showLatest && <RoundResult sessionId={view.sessionId} result={latest} names={names} />}

      <h2>計分</h2>
      <table>
        <tbody>
          {ranking.map((id) => (
            <tr key={id}>
              <td>{names[id]}</td>
              <td>{game.scores[id]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {game.history.length > 1 && (
        <details>
          <summary>歷史回合</summary>
          {game.history.slice(0, showLatest ? -1 : undefined).map((r) => (
            <RoundResult key={r.round} sessionId={view.sessionId} result={r} names={names} />
          ))}
        </details>
      )}
    </section>
  );
}
