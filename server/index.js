import "dotenv/config";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { createTravelAgent } from "./src/agent.js";
import { createApp } from "./src/app.js";

const tracingEnabled = process.env.LANGSMITH_TRACING === "true";
if (tracingEnabled) {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key || key.startsWith("your-")) {
    console.warn("⚠️  LANGSMITH_TRACING=true but LANGSMITH_API_KEY is not set; traces will fail to upload.");
  }
}

const app = createApp({ agent: createTravelAgent() });

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Travel agent API on http://localhost:${PORT}`);
  console.log(
    tracingEnabled
      ? `LangSmith tracing ON (project: ${process.env.LANGSMITH_PROJECT || "default"})`
      : "LangSmith tracing OFF (set LANGSMITH_TRACING=true to enable)"
  );
});

// Flush any pending LangSmith traces before exiting.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await awaitAllCallbacks();
    process.exit(0);
  });
}
