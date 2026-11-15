# Wanderlust: LangChain Travel Agent

A conversational travel assistant built with **LangChain.js** (`createAgent`), **Gemini `gemini-3.1-flash-lite`**,
an **Express** backend and a **React + Vite** chat UI.

## Features
| Requirement | Implementation |
|---|---|
| Chatbot interface | `client/src/App.jsx`: chat UI with Markdown replies, tool-usage chips, a preferences sidebar |
| Gemini LLM | `ChatGoogleGenerativeAI` with `gemini-3.1-flash-lite` (`server/src/agent.js`) |
| Web Search (Tavily) | `TavilySearch` tool named `web_search`, used for any travel query |
| Weather (wttr) | `weather_lookup` tool calling `https://wttr.in/<city>?format=j1` |
| In-memory checkpointer | `MemorySaver` keyed by `thread_id`. Stores the conversation and a `preferences` state field |

### How preferences are stored
- The agent state is extended with `preferences: Record<string,string>`.
- When the user mentions a lasting preference (budget, home city, diet…), the agent calls
  `save_user_preference`, which returns a LangGraph `Command` that updates `preferences` in state.
- The `MemorySaver` checkpointer saves that state per `thread_id`, so it carries over to later turns.
- A middleware adds the saved preferences to the system prompt on every model call.
- The data lives in memory only, so restarting the server clears it.

## Setup
```bash
# 1. Backend
cd server
npm install
cp .env.example .env     # add GOOGLE_API_KEY and TAVILY_API_KEY
npm run dev              # http://localhost:3001

# 2. Frontend (new terminal)
cd client
npm install
npm run dev              # http://localhost:5173 (proxies /api to :3001)
```

Get keys: Gemini at https://aistudio.google.com/apikey, Tavily at https://app.tavily.com

## Tracing with LangSmith
Agent runs are traced to [LangSmith](https://smith.langchain.com). This includes every model call, tool call
(web search, weather, saved preferences) and the token usage for each.

1. Create an API key at https://smith.langchain.com/settings.
2. In `server/.env`, set:
   ```
   LANGSMITH_TRACING=true
   LANGSMITH_API_KEY=<your key>
   LANGSMITH_PROJECT=wk10-travel-agent
   ```
3. Restart the server. It prints `LangSmith tracing ON` at startup.

Each chat turn is recorded as a `travel-agent-chat` run tagged `travel-agent`. Each run carries
`thread_id` as metadata, so all turns of one conversation appear together in the project's **Threads** tab.
Set `LANGSMITH_TRACING=false` to turn tracing off.

## Tests
Integration tests for the API live in `server/tests`. They use Vitest and supertest.
```bash
cd server
npm test            # single run
npm run test:watch  # watch mode
```
The tests run the real agent graph, checkpointer, preferences middleware and `save_user_preference` tool. Outside services are replaced, so no API keys or network access are needed:
- Gemini is replaced by a scripted chat model (`tests/helpers/scriptedModel.js`). It returns preset replies and tool calls, and records the prompts it receives.
- Tavily is replaced by a fake `web_search` tool.
- wttr.in is replaced by a stubbed `fetch`.

## API
- `POST /api/chat` `{ message, threadId }` returns `{ reply, toolsUsed, preferences }`
- `GET /api/preferences/:threadId` returns `{ preferences }`
