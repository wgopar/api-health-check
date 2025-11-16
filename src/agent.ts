import pkg from "../package.json" assert { type: "json" };
import { createAgentApp } from "@lucid-agents/agent-kit-hono";
import type { AgentKitConfig } from "@lucid-agents/agent-kit";
import { createAgentIdentity, generateAgentMetadata, getTrustConfig } from "@lucid-agents/agent-kit-identity";
import { logger } from "./logger";
import { apiHealthCheck } from "./entrypoints/apiHealthCheck";


// added for testing purposes
const shouldAutoRegister =
  process.env.REGISTER_IDENTITY === undefined
    ? true
    : process.env.REGISTER_IDENTITY === "true";

const identity = await createAgentIdentity({
  domain: process.env.AGENT_DOMAIN,
  autoRegister: shouldAutoRegister,
});

const metadata = generateAgentMetadata(identity, {
  name: "API Health Checker",
  description:
    "Runs rapid HTTP(S) probes, measures latency, and reports status for API endpoints.",
  capabilities: [
    {
      name: "http-health-monitoring",
      description:
        "Performs multiple HTTP(S) probes with HEAD/GET, checks status codes, and reports latency.",
    },
    {
      name: "uptime-alerting",
      description:
        "Triggers a webhook when checks fail or exceed latency budgets.",
    },
    {
      name: "latency-reporting",
      description:
        "Returns per-run timing details and flags when latency budgets are exceeded.",
    },
  ],
});

console.log(metadata)

logger.info("identity_status", "Fetched agent identity status", {
  status: identity.status,
  domain: identity.domain,
});

if (identity.didRegister) {
  logger.info("identity_registered", "Agent registered successfully", {
    transactionHash: identity.transactionHash,
    metadataUrl: `https://${identity.domain}/.well-known/agent-metadata.json`,
  });
} else if (identity.trust) {
  logger.info("identity_trusted", "Found existing agent registration", {
    agentId: identity.record?.agentId,
  });
} else {
  logger.info(
    "identity_unregistered",
    "No on-chain identity found; agent will run without registration"
  );
}

const BILLING_ENABLED = process.env.AGENT_BILLING_ENABLED === "true";

const configOverrides: AgentKitConfig | undefined = BILLING_ENABLED
  ? {
      payments: {
        facilitatorUrl: "https://facilitator.daydreams.systems",
        payTo: process.env.PAY_TO as `0x${string}`,
        network: process.env.NETWORK as any,
        defaultPrice: process.env.DEFAULT_PRICE,
      },
    }
  : undefined;

const createAppOptions: Parameters<typeof createAgentApp>[1] = {
  trust: getTrustConfig(identity),
};

if (configOverrides) {
  createAppOptions.config = configOverrides;
}

const AGENT_VERSION = process.env.AGENT_VERSION ?? pkg.version ?? "0.0.1";

const { app, addEntrypoint } = createAgentApp(
  {
    name: "API Health Checker",
    version: AGENT_VERSION,
    description:
      "API Health Checker that runs rapid HTTP(S) probes, captures latency, and can dispatch alert webhooks on failures.",
  },
  createAppOptions
);

addEntrypoint(apiHealthCheck);

export { app, metadata };
