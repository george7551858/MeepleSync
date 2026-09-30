import type { ParticipantView, SessionView } from "../../shared/protocol";
import { PHASE_LABEL } from "../labels";

function hint(view: SessionView, me: ParticipantView | undefined): string {
  if (!me) return "";
  if (me.role === "observer") return "你是觀察者，只能觀看";
  const req = view.phase.requirement;
  if (req?.actors.includes(me.userId)) return req.done.includes(me.userId) ? "已完成，等待其他人" : "輪到你操作";
  if (view.status === "lobby") return view.hostId === me.userId ? "你是主持人，人齊後可以開始" : "等待主持人開始";
  return "等待中";
}

export function PhaseBar({ view, me, now }: { view: SessionView; me: ParticipantView | undefined; now: number }) {
  const { phase } = view;
  const remaining = phase.deadline === null ? null : Math.max(0, Math.ceil((phase.deadline - now) / 1000));
  return (
    <section className="row">
      <strong>[{PHASE_LABEL[phase.name] ?? phase.name}]</strong>
      {remaining !== null && <span>剩餘 {remaining} 秒</span>}
      <span className="muted">{hint(view, me)}</span>
    </section>
  );
}
