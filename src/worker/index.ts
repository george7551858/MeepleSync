import { SESSION_ID_ALPHABET, SESSION_ID_PATTERN, isGameMode } from "../shared/protocol";

export { SessionDO } from "./session";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => SESSION_ID_ALPHABET[b % SESSION_ID_ALPHABET.length]).join("");
}

function sessionStub(env: Env, sessionId: string) {
  return env.SESSION.get(env.SESSION.idFromName(sessionId));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/sessions" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
      const mode = isGameMode(body?.mode) ? body.mode : "text";
      for (let attempt = 0; attempt < 5; attempt++) {
        const sessionId = newSessionId();
        if (await sessionStub(env, sessionId).init(sessionId, mode)) return json({ sessionId }, 201);
      }
      return json({ error: "could_not_allocate_id" }, 503);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(ws|log)$/);
    if (match && SESSION_ID_PATTERN.test(match[1])) {
      const [, sessionId, route] = match;
      if (route === "ws") {
        if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);
        return sessionStub(env, sessionId).fetch(request);
      }
      if (route === "log" && env.DEBUG === "1") return json(await sessionStub(env, sessionId).debugLog());
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
