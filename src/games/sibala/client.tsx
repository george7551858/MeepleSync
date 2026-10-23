import type { ClientGame, GameMessageProps, GamePanelProps } from "../../client/game";
import { participantName } from "../../client/game";
import { Author } from "../../client/components/Author";
import {
  DIE_SYMBOL,
  ROLL_TEXT,
  getDieRoles,
  sibalaView,
  type Die,
  type DieRole,
  type SibalaMessage,
  type SibalaRoll,
} from "./shared";

function DieView({ die, role = "plain" }: { die: Die; role?: DieRole }) {
  const isRed = die === 1 || die === 4;
  return (
    <span className={`die ${isRed ? "die-red" : "die-black"} die-role-${role}`} title={`骰子 ${die}`}>
      {DIE_SYMBOL[die]}
    </span>
  );
}

function DiceRollView({ roll }: { roll: SibalaRoll }) {
  const roles = getDieRoles(roll);
  return (
    <span className="dice-group">
      {roll.dice.map((d, i) => (
        <DieView key={i} die={d} role={roles[i]} />
      ))}
    </span>
  );
}

function PlainDiceView({ dice }: { dice: readonly Die[] }) {
  return (
    <span className="dice-group">
      {dice.map((d, i) => (
        <DieView key={i} die={d} role="plain" />
      ))}
    </span>
  );
}

function getBadgeType(roll: SibalaRoll): "quad" | "siba" | "high" | "low" | "bg" | "none" {
  if (roll.kind === "quad") return "quad";
  if (roll.kind === "none") return "none";
  if (roll.points === 12) return "siba";
  if (roll.points === 3) return "bg";
  if (roll.points !== null && roll.points >= 7) return "high";
  return "low";
}

function HandBadge({ roll }: { roll: SibalaRoll }) {
  const type = getBadgeType(roll);
  return <span className={`sibala-badge sibala-badge-${type}`}>{roll.label}</span>;
}

function SibalaMessageView({ message, meId }: GameMessageProps) {
  const data = message.data as SibalaMessage;
  switch (data.type) {
    case "started":
      return (
        <div>
          <PlainDiceView dice={[1, 2, 3, 4, 5, 6]} />{" "}
          <strong>十八骰仔開始</strong>，擲骰順序：
          {data.players.map((id) => data.names[id]).join(" → ")}
        </div>
      );
    case "rolled":
      return (
        <div>
          <Author name={data.name} isMe={data.userId === meId} /> 擲出{" "}
          <DiceRollView roll={data.roll} /> → <HandBadge roll={data.roll} />
          {data.roll.kind === "none" && "（重擲）"}
          {data.auto && "（系統代擲）"}
        </div>
      );
    case "result":
      return (
        <div>
          <strong>結果揭曉：</strong>
          {data.draw ? "平手" : `勝者 ${data.winners.map((w) => data.names[w]).join("、")}`}
          <ul className="plain indent" style={{ marginTop: "6px" }}>
            {Object.entries(data.rolls).map(([userId, roll]) => (
              <li key={userId} style={{ padding: "4px 0" }}>
                {data.names[userId]}：
                {roll ? (
                  <>
                    <DiceRollView roll={roll} /> <HandBadge roll={roll} />
                  </>
                ) : (
                  "未擲骰"
                )}
                {data.winners.includes(userId) && " ★"}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

function SibalaPanel({ view, meId }: GamePanelProps) {
  const game = sibalaView(view);
  if (!game) return null;
  return (
    <div className="game-panel">
      {game.roller && (
        <div style={{ marginBottom: "6px" }}>
          輪到 <strong>{game.roller === meId ? "你" : participantName(view, game.roller)}</strong> 擲骰
        </div>
      )}
      <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
        {game.players.map((p) => {
          const r = game.rolls[p];
          return (
            <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              {participantName(view, p)}：
              {r ? (
                <>
                  <DiceRollView roll={r} /> <HandBadge roll={r} />
                </>
              ) : (
                "等待擲骰"
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const sibalaClient: ClientGame = {
  label: "十八骰仔",
  phaseLabels: { rolling: "擲骰中" },
  errorLabels: {
    invalid_roll: `請輸入「${ROLL_TEXT}」擲骰`,
  },
  input(view, meId) {
    const game = sibalaView(view);
    if (!game || game.roller !== meId) return null;
    return {
      options: [{ text: ROLL_TEXT, label: `⚀⚁⚂⚃⚄⚅ ${ROLL_TEXT}` }],
      hint: `輪到你擲骰：輸入「${ROLL_TEXT}」或點擊下方按鈕擲出四顆骰子`,
      placeholder: `輸入 ${ROLL_TEXT}`,
    };
  },
  Message: SibalaMessageView,
  Panel: SibalaPanel,
};
