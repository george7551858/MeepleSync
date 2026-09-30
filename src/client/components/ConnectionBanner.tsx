import type { ConnStatus } from "../connection";

const MESSAGE: Partial<Record<ConnStatus, string>> = {
  connecting: "連線中…",
  reconnecting: "連線中斷，正在重新連線…（目前無法操作）",
  offline: "網路已中斷，恢復後會自動重新連線",
};

export function ConnectionBanner({ status }: { status: ConnStatus }) {
  const message = MESSAGE[status];
  return message ? <div className="banner">{message}</div> : null;
}
