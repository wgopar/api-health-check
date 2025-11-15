import { randomUUID } from "node:crypto";
import { z } from "zod";
import pkg from "../package.json" assert { type: "json" };
import { createAgentApp } from "@lucid-agents/agent-kit-hono";
import type { AgentKitConfig } from "@lucid-agents/agent-kit";
import { createAgentIdentity, generateAgentMetadata, getTrustConfig } from "@lucid-agents/agent-kit-identity";
import { logger } from "./logger";



const shouldAutoRegister =
  process.env.REGISTER_IDENTITY === undefined
    ? true
    : process.env.REGISTER_IDENTITY === "true";

const identity = await createAgentIdentity({
  domain: process.env.AGENT_DOMAIN,
  autoRegister: shouldAutoRegister,
});

// TODO: where do attach this metadata to? i think its actually included since i'm using
const metadata = generateAgentMetadata(identity, {
  name: "my Agent",
  description: 'Agent Health Checker',
  capabilities: [
    { name: 'chat', description: 'Natural language conversation' },
    { name: 'search', description: 'Web search' },
  ]
})

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

type HttpMethod = "HEAD" | "GET";

type HealthCheckResult = {
  status: number;
  ok: boolean;
  latencyMs: number;
  method: HttpMethod;
  timestamp: number;
  withinLatencyBudget: boolean;
  expectedStatusMet: boolean;
  errorMessage?: string;
};

type AlertDispatch = {
  dispatched: boolean;
  webhook?: string;
  status?: number;
  message: string;
};

const BILLING_ENABLED = process.env.AGENT_BILLING_ENABLED === "true";
const ALERT_WEBHOOK_UNIT_PRICE_USD = BILLING_ENABLED ? 0.05 : 0;
const BASE_MONITORING_PRICE = BILLING_ENABLED ? ".001" : "0";

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
const HEALTH_CHECK_ATTEMPTS = 4;
const HEALTH_CHECK_INTERVAL_MS = 250;

const { app, addEntrypoint } = createAgentApp(
  {
    name: "api-health-check",
    version: AGENT_VERSION,
    description:
      "HTTP(S) watchdog that fires four rapid probes, records the slowest latency, and optionally dispatches paid alert webhooks when any attempt fails.",
  },
  createAppOptions
);

const healthCheckInputSchema = z.object({
  url: z
    .string()
    .url({ message: "Provide a valid HTTP(S) URL to monitor." })
    .describe("HTTP(S) endpoint to verify."),
  method: z
    .enum(["HEAD", "GET"])
    .default("HEAD")
    .describe("HTTP method used for the probe."),
  expectedStatus: z
    .number()
    .int()
    .min(100)
    .max(599)
    .default(200)
    .describe("Status code considered healthy."),
  maxLatencyMs: z
    .number()
    .int()
    .positive()
    .default(1_000)
    .describe("Latency budget in milliseconds."),
  alertWebhookUrl: z
    .string()
    .url({ message: "Provide a valid webhook URL." })
    .optional()
    .describe("Webhook invoked when the health check fails."),
});

addEntrypoint({
  key: "api-health-check",
  description:
    "Send four 250 ms-spaced HEAD/GET probes to an HTTP(S) endpoint, evaluate status + latency budgets, and optionally dispatch billable alert webhooks on failure.",
  input: healthCheckInputSchema,
  output: z.object({
    health: z.object({
      url: z.string(),
      method: z.enum(["HEAD", "GET"]),
      checkedAt: z.string(),
      status: z.number(),
      expectedStatus: z.number(),
      ok: z.boolean(),
      expectedStatusMet: z.boolean(),
      latencyMs: z.number(),
      withinLatencyBudget: z.boolean(),
      errorMessage: z.string().optional(),
    }),
    alert: z
      .object({
        dispatched: z.boolean(),
        webhook: z.string().optional(),
        status: z.number().optional(),
        message: z.string(),
      })
      .optional(),
    billing: z.object({
      basePrice: z.string(),
      alertWebhookCount: z.number(),
      alertWebhookUnitPriceUsd: z.number(),
      totalUsd: z.number(),
    }),
    context: z.object({
      runId: z.string(),
      agentVersion: z.string(),
    }),
  }),
  async handler(ctx) {
    const {
      url,
      method,
      expectedStatus,
      maxLatencyMs,
      alertWebhookUrl,
    } = ctx.input as z.infer<typeof healthCheckInputSchema>;

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Input must be a valid URL string.");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    const runId = ctx.runId ?? randomUUID();

    logger.info("health_check_start", "Starting health check", {
      runId,
      url: parsedUrl.href,
      method,
      expectedStatus,
      maxLatencyMs,
      billing: BILLING_ENABLED ? "enabled" : "disabled",
    });

    const health = await monitorEndpoint(parsedUrl, {
      method,
      expectedStatus,
      maxLatencyMs,
    });

    let alertDispatch: AlertDispatch | undefined;
    if (!health.ok && alertWebhookUrl) {
      alertDispatch = await dispatchAlert(alertWebhookUrl, {
        runId,
        agentVersion: AGENT_VERSION,
        url: parsedUrl.href,
        status: health.status,
        expectedStatus,
        withinLatencyBudget: health.withinLatencyBudget,
        latencyMs: health.latencyMs,
        errorMessage: health.errorMessage,
      });
    }

    logger.info("health_check_complete", "Completed health check", {
      runId,
      url: parsedUrl.href,
      ok: health.ok,
      status: health.status,
      latencyMs: health.latencyMs,
      withinLatencyBudget: health.withinLatencyBudget,
      expectedStatusMet: health.expectedStatusMet,
      alertDispatched: alertDispatch?.dispatched ?? false,
    });

    const alertsTriggered = alertDispatch?.dispatched ? 1 : 0;
    const basePriceNumber = BILLING_ENABLED
      ? Number.parseFloat(BASE_MONITORING_PRICE)
      : 0;
    const normalizedBasePrice = Number.isFinite(basePriceNumber)
      ? basePriceNumber
      : 0;
    const totalUsd =
      normalizedBasePrice + alertsTriggered * ALERT_WEBHOOK_UNIT_PRICE_USD;

    return {
      output: {
        health: {
          url: parsedUrl.href,
          method: health.method,
          checkedAt: new Date(health.timestamp).toISOString(),
          status: health.status,
          expectedStatus,
          ok: health.ok,
          expectedStatusMet: health.expectedStatusMet,
          latencyMs: health.latencyMs,
          withinLatencyBudget: health.withinLatencyBudget,
          errorMessage: health.errorMessage,
        },
        alert: alertDispatch,
        billing: {
          basePrice: BASE_MONITORING_PRICE,
          alertWebhookCount: alertsTriggered,
          alertWebhookUnitPriceUsd: ALERT_WEBHOOK_UNIT_PRICE_USD,
          totalUsd,
        },
        context: {
          runId,
          agentVersion: AGENT_VERSION,
        },
      },
      model: health.ok ? "health-monitor/ok" : "health-monitor/alert",
    };
  },
});


async function monitorEndpoint(
  url: URL,
  options: {
    method: HttpMethod;
    expectedStatus: number;
    maxLatencyMs: number;
  }
): Promise<HealthCheckResult> {
  const attempts: HealthCheckResult[] = [];

  for (let attempt = 0; attempt < HEALTH_CHECK_ATTEMPTS; attempt++) {
    const result = await probeEndpointOnce(url, options);
    attempts.push(result);

    if (attempt < HEALTH_CHECK_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS)
      );
    }
  }

  const allAttemptsOk = attempts.every((attempt) => attempt.ok);
  const withinLatencyBudget = attempts.every(
    (attempt) => attempt.withinLatencyBudget
  );
  const expectedStatusMet = attempts.every(
    (attempt) => attempt.expectedStatusMet
  );
  const longestLatency = attempts.reduce(
    (max, attempt) => Math.max(max, attempt.latencyMs),
    0
  );
  const lastAttempt = attempts[attempts.length - 1];
  const firstFailure = attempts.find((attempt) => !attempt.ok);

  return {
    status: lastAttempt?.status ?? 0,
    ok: allAttemptsOk,
    latencyMs: longestLatency,
    method: lastAttempt?.method ?? options.method,
    timestamp: lastAttempt?.timestamp ?? Date.now(),
    withinLatencyBudget,
    expectedStatusMet,
    errorMessage: allAttemptsOk
      ? undefined
      : firstFailure?.errorMessage ?? "One or more health checks failed.",
  };
}

async function probeEndpointOnce(
  url: URL,
  options: {
    method: HttpMethod;
    expectedStatus: number;
    maxLatencyMs: number;
  }
): Promise<HealthCheckResult> {
  const methods: HttpMethod[] =
    options.method === "HEAD" ? ["HEAD", "GET"] : ["GET", "HEAD"];
  let lastError: string | undefined;

  for (const method of methods) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, { method, signal: controller.signal });
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const withinLatencyBudget = latencyMs <= options.maxLatencyMs;
      const expectedStatusMet =
        response.status === options.expectedStatus ||
        (options.expectedStatus === 200 &&
          response.status >= 200 &&
          response.status < 300);
      const ok = response.ok && expectedStatusMet && withinLatencyBudget;

      return {
        status: response.status,
        ok,
        latencyMs,
        method,
        timestamp: Date.now(),
        withinLatencyBudget,
        expectedStatusMet,
        errorMessage: ok
          ? undefined
          : `Response failed health check with status ${response.status}.`,
      };
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Unknown error occurred.";
    } finally {
      clearTimeout(timeout);
    }
  }

  logger.warn("health_check_retries_exhausted", "Health check failed after retries", {
    url: url.href,
    method: options.method,
    error: lastError,
  });

  return {
    status: 0,
    ok: false,
    latencyMs: options.maxLatencyMs,
    method: options.method,
    timestamp: Date.now(),
    withinLatencyBudget: false,
    expectedStatusMet: false,
    errorMessage: lastError,
  };
}

async function dispatchAlert(
  webhookUrl: string,
  payload: {
    runId: string;
    agentVersion: string;
    url: string;
    status: number;
    expectedStatus: number;
    withinLatencyBudget: boolean;
    latencyMs: number;
    errorMessage?: string;
  }
): Promise<AlertDispatch> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    logger.info("alert_dispatch_start", "Dispatching alert webhook", {
      webhookUrl,
      payload,
    });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event: "api.health.alert",
        payload,
        dispatchedAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    return {
      dispatched: response.ok,
      webhook: webhookUrl,
      status: response.status,
      message: response.ok
        ? "Alert webhook delivered."
        : `Webhook responded with status ${response.status}.`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to dispatch alert.";
    logger.warn("alert_dispatch_failed", "Alert webhook dispatch failed", {
      webhookUrl,
      message,
    });
    return {
      dispatched: false,
      webhook: webhookUrl,
      message,
    };
  } finally {
    clearTimeout(timeout);
    logger.info("alert_dispatch_complete", "Alert webhook attempt finished", {
      webhookUrl,
    });
  }
}

export { app };
