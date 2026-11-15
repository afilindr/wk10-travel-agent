import "dotenv/config";
import express from "express";
import cors from "cors";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { agent } from "./src/agent.js";

const tracingEnabled = process.env.LANGSMITH_TRACING === "true";
if (tracingEnabled) {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key || key.startsWith("your-")) {
    console.warn("⚠️  LANGSMITH_TRACING=true but LANGSMITH_API_KEY is not set; traces will fail to upload.");
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");

app.post("/api/chat", async (req, res) => {
  const { message, threadId } = req.body ?? {};
  if (!message || !threadId) {
    return res.status(400).json({ error: "message and threadId are required" });
  }
  try {
    const config = {
      configurable: { thread_id: threadId },
      // LangSmith: name the run, and group turns of one conversation into a thread.
      runName: "travel-agent-chat",
      tags: ["travel-agent"],
      metadata: { thread_id: threadId },
    };
    const result = await agent.invoke(
      { messages: [{ role: "user", content: message }] },
      config
    );

    // Collect the tools used during this turn (messages after the last human message).
    const msgs = result.messages;
    const lastHuman = msgs.findLastIndex((m) => m.type === "human");
    const toolsUsed = [
      ...new Set(
        msgs.slice(lastHuman + 1).flatMap((m) => (m.tool_calls ?? []).map((t) => t.name))
      ),
    ];

    res.json({
      reply: textOf(msgs.at(-1).content),
      toolsUsed,
      preferences: result.preferences ?? {},
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Agent error" });
  }
});

app.get("/api/preferences/:threadId", async (req, res) => {
  const state = await agent.getState({ configurable: { thread_id: req.params.threadId } });
  res.json({ preferences: state.values?.preferences ?? {} });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
