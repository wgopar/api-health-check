import { app } from "./agent";
import { logger } from "./logger";

const port = Number(process.env.PORT ?? 8787);
const basePath = process.env.AGENT_BASE_PATH ?? "/api-health-check";

const server = Bun.serve({
  port,
  fetch(req) {
    if (basePath !== "/") {
      const url = new URL(req.url);
      if (
        url.pathname === basePath ||
        url.pathname.startsWith(`${basePath}/`)
      ) {
        const strippedPath = url.pathname.slice(basePath.length) || "/";
        const rewrittenUrl = new URL(req.url);
        rewrittenUrl.pathname = strippedPath.startsWith("/")
          ? strippedPath
          : `/${strippedPath}`;
        return app.fetch(new Request(rewrittenUrl.toString(), req));
      }
    }

    return app.fetch(req);
  },
});

logger.info("server_started", "Agent server ready", {
  hostname: server.hostname,
  port: server.port,
  basePath,
  manifestUrl: `http://${server.hostname}:${server.port}${basePath}/.well-known/agent.json`,
});
