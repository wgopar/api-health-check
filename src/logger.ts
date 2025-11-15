type LogLevel = "debug" | "info" | "warn" | "error";

type LogInput = {
  event: string;
  message: string;
  data?: Record<string, unknown>;
};

const SERVICE_NAME =
  process.env.AGENT_NAME ?? process.env.APP_NAME ?? "api-health-check";

function log(level: LogLevel, { event, message, data }: LogInput) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    level,
    event,
    message,
  };

  if (data && Object.keys(data).length > 0) {
    entry.data = data;
  }

  const serialized = JSON.stringify(entry, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    return value;
  });

  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (event: string, message: string, data?: Record<string, unknown>) =>
    log("debug", { event, message, data }),
  info: (event: string, message: string, data?: Record<string, unknown>) =>
    log("info", { event, message, data }),
  warn: (event: string, message: string, data?: Record<string, unknown>) =>
    log("warn", { event, message, data }),
  error: (event: string, message: string, data?: Record<string, unknown>) =>
    log("error", { event, message, data }),
};
