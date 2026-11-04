// qnfo-container-executor v0.1.0 - DO-bound Containers code executor (QNFO)
import { Container } from "@cloudflare/containers";

export class CodeExecutor extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", worker: "qnfo-container-executor", version: "0.1.0", containerBound: !!env.EXECUTOR }), { headers: { "content-type": "application/json" } });
    }
    const session = url.searchParams.get("session") || "default";
    return getContainer(env.EXECUTOR, session).fetch(request);
  },
};
