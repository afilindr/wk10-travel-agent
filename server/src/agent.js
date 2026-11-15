import { createAgent, createMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { webSearch, weatherLookup, saveUserPreference } from "./tools.js";

const model = new ChatGoogleGenerativeAI({
  model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.4,
});

// In-memory checkpointer: keeps the conversation and user preferences per thread_id.
export const checkpointer = new MemorySaver();

const stateSchema = z.object({
  preferences: z.record(z.string(), z.string()).default({}),
});

const BASE_PROMPT = `You are Wanderlust, a friendly and knowledgeable travel assistant.

Tools:
- web_search: use it for ANY travel-related question (destinations, things to do, flights, hotels,
  visas, prices, events, transport, safety). Do not rely on memory for facts that may be outdated.
- weather_lookup: use it whenever the user asks about weather or what to pack for a city.
- save_user_preference: whenever the user states a lasting preference (budget, home city,
  travel style, diet, interests, preferred units, etc.), save it.

Guidelines:
- Tailor every recommendation to the saved user preferences below.
- Be concise and well-structured; use Markdown headings and bullet lists.
- Cite sources (links) from web search results when useful.
- Today's date is ${new Date().toDateString()}.`;

// Injects the saved preferences (from checkpointed state) into the system prompt each model call.
const preferencesPrompt = createMiddleware({
  name: "PreferencesPrompt",
  stateSchema,
  wrapModelCall: async (request, handler) => {
    const prefs = request.state.preferences ?? {};
    const lines = Object.entries(prefs).map(([k, v]) => `- ${k}: ${v}`);
    const prompt = `${BASE_PROMPT}\n\nSaved user preferences:\n${
      lines.length ? lines.join("\n") : "- (none yet)"
    }`;
    return handler({ ...request, systemMessage: request.systemMessage.concat(prompt) });
  },
});

export const agent = createAgent({
  model,
  tools: [webSearch, weatherLookup, saveUserPreference],
  stateSchema,
  checkpointer,
  middleware: [preferencesPrompt],
});
