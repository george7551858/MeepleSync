import { useState } from "react";
import type { Navigate } from "../App";
import { Meeple } from "../components/Meeple";
import { loadIdentity, randomName, saveName } from "../identity";

const ID_IN_TEXT = /([23456789abcdefghjkmnpqrstuvwxyz]{8})/;

export function Home({ navigate }: { navigate: Navigate }) {
  const [name, setName] = useState(() => loadIdentity().name);
  const [placeholder] = useState(randomName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The name that will actually be used (input or placeholder). */
  const displayName = name.trim() || placeholder;

  const ensureName = () => {
    const saved = saveName(displayName);
    if (saved.name) return true;
    setError("請先輸入顯示名稱");
    return false;
  };

  const create = async () => {
    if (!ensureName()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST", body: JSON.stringify({ mode: "text" }) });
      if (!res.ok) throw new Error(String(res.status));
      const { sessionId } = (await res.json()) as { sessionId: string };
      navigate(`/s/${sessionId}`);
    } catch {
      setError("建立房間失敗，請稍後再試");
      setBusy(false);
    }
  };

  const join = () => {
    if (!ensureName()) return;
    const id = code.trim().toLowerCase().match(ID_IN_TEXT)?.[1];
    if (!id) return setError("請輸入房間 ID 或分享連結");
    navigate(`/s/${id}`);
  };

  return (
    <main className="home">
      <h1>MeepleSync</h1>
      <p className="muted">免註冊的多人即時房間。建立房間後把連結分享給朋友即可。</p>

      <div className="avatar-preview">
        <Meeple name={displayName} size={48} />
      </div>

      <label className="field-label">顯示名稱</label>
      <input
        className="name-input"
        value={name}
        maxLength={20}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="home-actions">
        <button className="primary big" disabled={busy} onClick={create}>
          建立房間
        </button>

        <div className="divider"><span>或</span></div>

        <div className="join-row">
          <input
            className="grow"
            value={code}
            placeholder="房間 ID 或連結"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          />
          <button className="primary" onClick={join}>加入房間</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
