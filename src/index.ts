import { app, metadata } from "./agent";
import { logger } from "./logger";

const port = Number(process.env.PORT ?? 8787);

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/.well-known/agent-metadata.json") {
      return new Response(JSON.stringify(metadata), {
        headers: { "content-type": "application/json" },
      });
    }

    return app.fetch(req);
  },
});

logger.info("server_started", "Agent server ready", {
  hostname: server.hostname,
  port: server.port,
  manifestUrl: `http://${server.hostname}:${server.port}/.well-known/agent.json`,
  metadataUrl: `http://${server.hostname}:${server.port}/.well-known/agent-metadata.json`,
});
