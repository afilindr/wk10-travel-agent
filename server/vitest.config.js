import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    testTimeout: 15000,
    // Never send test runs to LangSmith or require real API keys.
    env: { LANGSMITH_TRACING: "false" },
  },
});
