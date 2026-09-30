import { useEffect, useState } from "react";
import { SESSION_ID_PATTERN } from "../shared/protocol";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";

export type Navigate = (to: string) => void;

export function App() {
  const [location, setLocation] = useState(() => new URL(window.location.href));

  useEffect(() => {
    const onPop = () => setLocation(new URL(window.location.href));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate: Navigate = (to) => {
    window.history.pushState(null, "", to);
    setLocation(new URL(window.location.href));
  };

  const match = location.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (match && SESSION_ID_PATTERN.test(match[1])) {
    const role = location.searchParams.get("as") === "observer" ? "observer" : "player";
    return <Room key={match[1] + role} sessionId={match[1]} role={role} navigate={navigate} />;
  }
  return <Home navigate={navigate} />;
}
