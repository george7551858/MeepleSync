import { useState } from "react";
import type { Navigate } from "../App";
import { loadIdentity, saveName } from "../identity";

const ID_IN_TEXT = /([23456789abcdefghjkmnpqrstuvwxyz]{8})/;

export function Home({ navigate }: { navigate: Navigate }) {
  const [name, setName] = useState(() => loadIdentity().name);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureName = () => {
    if (saveName(name).name) return true;
    setError("請先輸入顯示名稱");
    return false;
  };

  const create = async () => {
    if (!ensureName()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { sessionId } = (await res.json()) as { sessionId: string };
      navigate(`/s/${sessionId}`);
    } catch {
      setError("建立房間失敗，請稍後再試");
      setBusy(false);
    }
  };

  const join = (asObserver: boolean) => {
    if (!ensureName()) return;
    const id = code.trim().toLowerCase().match(ID_IN_TEXT)?.[1];
    if (!id) return setError("請輸入房間 ID 或分享連結");
    navigate(`/s/${id}${asObserver ? "?as=observer" : ""}`);
  };

  return (
    <main>
      <h1>MeepleSync</h1>
      <p className="muted">免註冊的多人即時房間。建立房間後把連結分享給朋友即可。</p>

      <h2>顯示名稱</h2>
      <div className="row">
        <input value={name} maxLength={20} placeholder="你的名字" onChange={(e) => setName(e.target.value)} />
      </div>

      <h2>建立房間</h2>
      <button className="primary" disabled={busy} onClick={create}>
        建立新房間
      </button>

      <h2>加入房間</h2>
      <div className="row">
        <input value={code} placeholder="房間 ID 或連結" onChange={(e) => setCode(e.target.value)} />
        <button onClick={() => join(false)}>以玩家加入</button>
        <button onClick={() => join(true)}>以觀察者加入</button>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
