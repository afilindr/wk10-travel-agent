# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Wanderlust": a conversational travel agent. It has two separate npm packages and no root `package.json`:
- `server/`: Express 5 API running a LangChain.js v1 agent (`createAgent`) on Gemini `gemini-3.1-flash-lite`.
- `client/`: React 19 + Vite chat UI.

Both use ES modules and plain JavaScript (no TypeScript).

## Commands

Run each package from its own directory.

```bash
# server/
npm run dev                          # node --watch index.js, port 3001 (PORT env)
npm start
npm test                             # vitest run (all integration tests)
npx vitest run -t "saves a preference"   # single test, matched by name
npm run test:watch

# client/
npm run dev                          # Vite on :5173; proxies /api -> http://localhost:3001
npm run build
npm run lint                         # oxlint (react + oxc plugins)
```

`server/.env` holds `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `GEMINI_MODEL`, `PORT` and `LANGSMITH_*`. See `server/.env.example`. Claude Code is denied read access to `.env` files (`.claude/settings.json`), so use `.env.example` to learn the variable names.

## Server architecture

The server is split so that every external dependency can be injected:

- `server/index.js`: the only entry point with side effects. It loads dotenv, builds `createApp({ agent: createTravelAgent() })`, listens, and on SIGINT/SIGTERM flushes LangSmith traces with `awaitAllCallbacks()`.
- `server/src/app.js`: `createApp({ agent })` returns an Express app and never calls `listen` (supertest uses it directly). Routes:
  - `POST /api/chat {message, threadId}` returns `{reply, toolsUsed, preferences}`.
    - `toolsUsed` holds only tool calls made after the last human message, so earlier turns are excluded.
    - `reply` flattens Gemini's array-of-content-blocks replies into text.
  - `GET /api/preferences/:threadId` reads `agent.getState()`.
  - `GET /api/health`.
- `server/src/agent.js`: `createTravelAgent({ model, tools, checkpointer })`. Each argument defaults to the real implementation: Gemini, `[createWebSearch(), weatherLookup, saveUserPreference]`, and `new MemorySaver()`.
- `server/src/tools.js`:
  - `createWebSearch()`: a factory, because `TavilySearch` throws at construction time if no API key is set.
  - `weatherLookup`: fetches `wttr.in/<city>?format=j1` and formats current conditions plus a 3-day forecast.
  - `saveUserPreference`.

### How user preferences flow (spans several files)
1. The agent's `stateSchema` adds `preferences: Record<string,string>` beside `messages`.
2. `save_user_preference` reads `runtime.state.preferences`. It returns a LangGraph `Command({ update: { preferences: merged, messages: [ToolMessage] } })`. The `ToolMessage` must carry `runtime.toolCallId`.
3. `MemorySaver` saves that state under `configurable.thread_id`. The thread id comes from the client, which generates it and stores it in `localStorage`. All data is lost when the server restarts.
4. The custom `PreferencesPrompt` middleware (`createMiddleware` with `wrapModelCall`) appends the base prompt and the saved preferences to the system message on every model call.
   - The middleware must declare `stateSchema` itself. Otherwise `request.state` has no `preferences` field.
   - For the same reason the built-in `dynamicSystemPromptMiddleware` was tried and doesn't work here.

### LangSmith tracing
Tracing is switched on purely by environment variables (`LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`). `app.js` passes `runName: "travel-agent-chat"`, `tags`, and `metadata.thread_id`, so LangSmith groups the turns of a conversation into Threads.

## Tests

`server/tests/api.test.js` contains supertest integration tests. They run the **real** agent graph, checkpointer, middleware and preference tool, without network access or keys:
- `tests/helpers/scriptedModel.js`: `ScriptedChatModel` is a `BaseChatModel` that returns queued responses, which are either a string or `{ toolCalls: [{name, args}] }`. It records each call's input messages in `model.calls`, and `systemPromptOf(call)` extracts the system prompt.
  - Each tool-calling step uses one scripted response, followed by a final text response.
  - If the queue runs out, the model throws, which produces a 500.
- `tests/helpers/fixtures.js`: a fake `web_search` tool (records its queries) and a wttr.in JSON fixture. Weather tests stub `fetch` with `vi.stubGlobal`.
- Error-path and response-shape tests pass a stub `{ invoke, getState }` object straight to `createApp`.
- `vitest.config.js` forces `LANGSMITH_TRACING=false`.

LangChain's own `FakeToolCallingModel` resets its script index based on message counts. That makes it unreliable across multiple turns, so use `ScriptedChatModel` instead.
