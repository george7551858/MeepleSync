import type { ClientGame, GameMessageProps, GamePanelProps } from "../../client/game";
import { participantName } from "../../client/game";
import {
  cardLabel,
  oldMaidView,
  suitOf,
  type Card,
  type OldMaidDrewSecret,
  type OldMaidMessage,
} from "./shared";

function CardText({ card }: { card: Card }) {
  const red = suitOf(card) === "H" || suitOf(card) === "D";
  return <span className={red ? "card card-red" : "card"}>{cardLabel(card)}</span>;
}

function Cards({ cards }: { cards: Card[] }) {
  return (
    <>
      {cards.map((c, i) => (
        <span key={c}>
          {i > 0 && " "}
          <CardText card={c} />
        </span>
      ))}
    </>
  );
}

function OldMaidMessageView({ message, meId }: GameMessageProps) {
  const data = message.data as OldMaidMessage;
  switch (data.type) {
    case "dealt":
      return (
        <div>
          <strong>發牌完成</strong>，各自丟掉成對的牌：
          <ul className="plain indent">
            {Object.entries(data.pairs).map(([id, pairs]) => (
              <li key={id}>
                {data.names[id]}：丟掉 {pairs} 對，剩 {data.counts[id]} 張
              </li>
            ))}
          </ul>
        </div>
      );
    case "drew": {
      const card = (message.secret?.data as OldMaidDrewSecret | undefined)?.card;
      const { drawer, target, names } = data;
      return (
        <div>
          {names[drawer]} 從 {names[target]} 抽了第 {data.index} 張
          {data.auto && "（系統代抽）"}
          {card && !data.pair && (
            <>
              （{meId === drawer ? "抽到" : "被抽走"} <CardText card={card} />）
            </>
          )}
          {data.pair && (
            <>
              ，湊成一對 <Cards cards={data.pair} /> 丟掉
            </>
          )}
          {data.out.map((id) => (
            <div key={id}>{names[id]} 手牌出完了！</div>
          ))}
        </div>
      );
    }
    case "result":
      return (
        <div>
          <strong>遊戲結束：</strong>
          {data.loser ? `🃏 ${data.names[data.loser]} 拿到鬼牌！` : "沒有人拿到鬼牌"}
          {data.out.length > 0 && <div>先出完：{data.out.map((id) => data.names[id]).join("、")}</div>}
        </div>
      );
  }
}

function OldMaidPanel({ view, meId }: GamePanelProps) {
  const game = oldMaidView(view);
  if (!game) return null;
  return (
    <div className="game-panel">
      {game.drawer && (
        <div>
          輪到 <strong>{game.drawer === meId ? "你" : participantName(view, game.drawer)}</strong> 從{" "}
          {game.target === meId ? "你" : participantName(view, game.target)} 抽牌
        </div>
      )}
      <div className="muted">
        {game.players
          .map((p) => `${participantName(view, p)} ${game.counts[p] ? `${game.counts[p]} 張` : "✓ 出完"}`)
          .join(" · ")}
      </div>
      {game.myHand && game.myHand.length > 0 && (
        <div>
          你的手牌（{game.myHand.length}）：<Cards cards={game.myHand} />
        </div>
      )}
    </div>
  );
}

export const oldMaidClient: ClientGame = {
  label: "抽鬼牌",
  phaseLabels: { drawing: "抽牌中" },
  errorLabels: { invalid_draw: "請輸入要抽第幾張牌（數字）" },
  input(view, meId) {
    const game = oldMaidView(view);
    if (!game || game.drawer !== meId || !game.target) return null;
    const n = game.counts[game.target] ?? 0;
    return {
      options: Array.from({ length: n }, (_, i) => ({ text: String(i + 1), label: String(i + 1) })),
      hint: `輪到你從 ${participantName(view, game.target)} 抽牌：輸入 1–${n} 選一張`,
      placeholder: `輸入 1–${n}`,
    };
  },
  Message: OldMaidMessageView,
  Panel: OldMaidPanel,
};
