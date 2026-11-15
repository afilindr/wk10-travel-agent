import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createTravelAgent } from "../src/agent.js";
import { weatherLookup, saveUserPreference } from "../src/tools.js";
import { ScriptedChatModel, systemPromptOf } from "./helpers/scriptedModel.js";
import { wttrFixture, createFakeWebSearch } from "./helpers/fixtures.js";

/** Build a real agent (graph + MemorySaver + middleware) around a scripted model. */
function setup(responses) {
  const model = new ScriptedChatModel(responses);
  const webSearch = createFakeWebSearch();
  const agent = createTravelAgent({
    model,
    tools: [webSearch.tool, weatherLookup, saveUserPreference],
  });
  return { app: createApp({ agent }), model, agent, webSearch };
}

const chat = (app, body) => request(app).post("/api/chat").send(body);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const { app } = setup([]);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("POST /api/chat: validation", () => {
  it.each([
    ["message is missing", { threadId: "t1" }],
    ["threadId is missing", { message: "hi" }],
    ["message is empty", { message: "", threadId: "t1" }],
    ["body is empty", {}],
  ])("returns 400 when %s", async (_label, body) => {
    const { app, model } = setup([]);
    const res = await chat(app, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "message and threadId are required" });
    expect(model.calls).toHaveLength(0);
  });

  it("returns 400 for a non-JSON body", async () => {
    const { app } = setup([]);
    const res = await request(app).post("/api/chat").set("Content-Type", "text/plain").send("hi");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat: conversation", () => {
  it("returns the model reply with no tools used", async () => {
    const { app, model } = setup(["Hello! Where would you like to go?"]);
    const res = await chat(app, { message: "hi", threadId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reply: "Hello! Where would you like to go?",
      toolsUsed: [],
      preferences: {},
    });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].at(-1).content).toBe("hi");
  });

  it("includes the travel-agent system prompt", async () => {
    const { app, model } = setup(["ok"]);
    await chat(app, { message: "hi", threadId: "t1" });
    const prompt = systemPromptOf(model.calls[0]);
    expect(prompt).toContain("Wanderlust");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("- (none yet)");
  });

  it("keeps conversation history per thread via the checkpointer", async () => {
    const { app, model } = setup(["First answer", "Second answer"]);
    await chat(app, { message: "I want to visit Japan", threadId: "t1" });
    await chat(app, { message: "What about food?", threadId: "t1" });

    const secondCall = model.calls[1].map((m) => m.content);
    expect(secondCall).toContain("I want to visit Japan");
    expect(secondCall).toContain("First answer");
    expect(secondCall).toContain("What about food?");
  });

  it("does not share history between threads", async () => {
    const { app, model } = setup(["A", "B"]);
    await chat(app, { message: "Secret plan for Peru", threadId: "thread-a" });
    await chat(app, { message: "hello", threadId: "thread-b" });

    const contents = model.calls[1].map((m) => m.content);
    expect(contents).not.toContain("Secret plan for Peru");
  });
});

describe("POST /api/chat: tools", () => {
  it("uses web_search for a travel question and reports it", async () => {
    const { app, webSearch } = setup([
      { toolCalls: [{ name: "web_search", args: { query: "things to do in Lisbon" } }] },
      "Visit Alfama ([guide](https://example.com/lisbon)).",
    ]);
    const res = await chat(app, { message: "What should I do in Lisbon?", threadId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body.toolsUsed).toEqual(["web_search"]);
    expect(res.body.reply).toContain("Alfama");
    expect(webSearch.queries).toEqual(["things to do in Lisbon"]);
  });

  it("uses weather_lookup, calling wttr.in and passing the result to the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wttrFixture), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { app, model } = setup([
      { toolCalls: [{ name: "weather_lookup", args: { city: "Lisbon" } }] },
      "It's 18°C and partly cloudy in Lisbon.",
    ]);
    const res = await chat(app, { message: "Weather in Lisbon?", threadId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body.toolsUsed).toEqual(["weather_lookup"]);
    expect(res.body.reply).toBe("It's 18°C and partly cloudy in Lisbon.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://wttr.in/Lisbon?format=j1",
      expect.any(Object)
    );

    const toolMsg = model.calls[1].find((m) => m.type === "tool");
    expect(toolMsg.content).toContain("Weather for Lisbon, Portugal");
    expect(toolMsg.content).toContain("Partly cloudy, 18°C (64°F)");
    expect(toolMsg.content).toContain("2026-11-15: 12–19°C");
  });

  it("URL-encodes city names for wttr.in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wttrFixture), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { app } = setup([
      { toolCalls: [{ name: "weather_lookup", args: { city: "São Paulo" } }] },
      "done",
    ]);
    await chat(app, { message: "weather", threadId: "t1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://wttr.in/S%C3%A3o%20Paulo?format=j1");
  });

  it("returns a graceful message to the model when wttr.in fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    const { app, model } = setup([
      { toolCalls: [{ name: "weather_lookup", args: { city: "Atlantis" } }] },
      "Sorry, I couldn't get the weather.",
    ]);
    const res = await chat(app, { message: "Weather in Atlantis?", threadId: "t1" });

    expect(res.status).toBe(200);
    const toolMsg = model.calls[1].find((m) => m.type === "tool");
    expect(toolMsg.content).toContain('Could not fetch weather for "Atlantis" (HTTP 503)');
  });

  it("reports multiple tools used in one turn, without duplicates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify(wttrFixture)))
    );
    const { app } = setup([
      {
        toolCalls: [
          { name: "weather_lookup", args: { city: "Lisbon" } },
          { name: "web_search", args: { query: "Lisbon events" } },
        ],
      },
      { toolCalls: [{ name: "web_search", args: { query: "Lisbon restaurants" } }] },
      "Here is your plan.",
    ]);
    const res = await chat(app, { message: "Plan my Lisbon weekend", threadId: "t1" });
    expect(res.body.toolsUsed.sort()).toEqual(["weather_lookup", "web_search"]);
  });

  it("only reports tools used in the current turn", async () => {
    const { app } = setup([
      { toolCalls: [{ name: "web_search", args: { query: "Rome" } }] },
      "Rome info",
      "You're welcome!",
    ]);
    await chat(app, { message: "Tell me about Rome", threadId: "t1" });
    const res = await chat(app, { message: "Thanks", threadId: "t1" });
    expect(res.body.toolsUsed).toEqual([]);
    expect(res.body.reply).toBe("You're welcome!");
  });
});

describe("User preferences (in-memory checkpointer)", () => {
  it("saves a preference and returns it from /api/chat", async () => {
    const { app } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "diet", value: "vegetarian" } }] },
      "Noted: you're vegetarian.",
    ]);
    const res = await chat(app, { message: "I'm vegetarian", threadId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body.toolsUsed).toEqual(["save_user_preference"]);
    expect(res.body.preferences).toEqual({ diet: "vegetarian" });
  });

  it("exposes saved preferences via GET /api/preferences/:threadId", async () => {
    const { app } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "budget", value: "mid-range" } }] },
      "Got it.",
    ]);
    await chat(app, { message: "Mid-range budget please", threadId: "t1" });

    const res = await request(app).get("/api/preferences/t1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: { budget: "mid-range" } });
  });

  it("returns empty preferences for an unknown thread", async () => {
    const { app } = setup([]);
    const res = await request(app).get("/api/preferences/never-seen");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: {} });
  });

  it("accumulates preferences across turns and overwrites existing keys", async () => {
    const { app } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "budget", value: "low" } }] },
      "ok",
      {
        toolCalls: [
          { name: "save_user_preference", args: { key: "home_city", value: "Austin" } },
        ],
      },
      "ok",
      { toolCalls: [{ name: "save_user_preference", args: { key: "budget", value: "luxury" } }] },
      "ok",
    ]);
    await chat(app, { message: "low budget", threadId: "t1" });
    await chat(app, { message: "I live in Austin", threadId: "t1" });
    const res = await chat(app, { message: "actually, luxury", threadId: "t1" });

    expect(res.body.preferences).toEqual({ budget: "luxury", home_city: "Austin" });
  });

  it("keeps preferences isolated per thread", async () => {
    const { app } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "diet", value: "vegan" } }] },
      "ok",
      "hello",
    ]);
    await chat(app, { message: "I'm vegan", threadId: "alice" });
    const res = await chat(app, { message: "hi", threadId: "bob" });

    expect(res.body.preferences).toEqual({});
    expect((await request(app).get("/api/preferences/alice")).body.preferences).toEqual({
      diet: "vegan",
    });
  });

  it("injects saved preferences into the system prompt on later turns", async () => {
    const { app, model } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "diet", value: "vegetarian" } }] },
      "Noted.",
      "Try the veggie ramen in Tokyo.",
    ]);
    await chat(app, { message: "I'm vegetarian", threadId: "t1" });
    await chat(app, { message: "Food in Tokyo?", threadId: "t1" });

    const prompt = systemPromptOf(model.calls.at(-1));
    expect(prompt).toContain("Saved user preferences:\n- diet: vegetarian");
    expect(prompt).not.toContain("(none yet)");
  });

  it("records the tool confirmation message in the conversation", async () => {
    const { app, agent } = setup([
      { toolCalls: [{ name: "save_user_preference", args: { key: "units", value: "celsius" } }] },
      "ok",
    ]);
    await chat(app, { message: "Use celsius", threadId: "t1" });
    const state = await agent.getState({ configurable: { thread_id: "t1" } });
    const toolMsg = state.values.messages.find((m) => m.type === "tool");
    expect(toolMsg.content).toBe("Saved preference: units = celsius");
  });
});

describe("Error handling and response shaping (stub agent)", () => {
  it("returns 500 with the error message when the agent throws", async () => {
    const agent = { invoke: vi.fn().mockRejectedValue(new Error("Gemini quota exceeded")) };
    const res = await chat(createApp({ agent }), { message: "hi", threadId: "t1" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Gemini quota exceeded" });
  });

  it("returns 500 when the real agent's model fails", async () => {
    const { app } = setup([]); // no scripted responses -> model throws
    const res = await chat(app, { message: "hi", threadId: "t1" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/no scripted responses left/);
  });

  it("returns 500 when loading preferences fails", async () => {
    const agent = { getState: vi.fn().mockRejectedValue(new Error("checkpointer down")) };
    const res = await request(createApp({ agent })).get("/api/preferences/t1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "checkpointer down" });
  });

  it("joins text blocks when the model returns array content (Gemini style)", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          { type: "human", content: "hi" },
          {
            type: "ai",
            content: [
              { type: "text", text: "Hello " },
              { type: "thinking", thinking: "hidden" },
              { type: "text", text: "traveler!" },
            ],
          },
        ],
        preferences: { budget: "low" },
      }),
    };
    const res = await chat(createApp({ agent }), { message: "hi", threadId: "t1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "Hello traveler!", toolsUsed: [], preferences: { budget: "low" } });
  });

  it("passes thread_id and LangSmith run metadata to the agent", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({ messages: [{ type: "ai", content: "ok" }] }),
    };
    await chat(createApp({ agent }), { message: "hi", threadId: "abc-123" });
    expect(agent.invoke).toHaveBeenCalledWith(
      { messages: [{ role: "user", content: "hi" }] },
      expect.objectContaining({
        configurable: { thread_id: "abc-123" },
        runName: "travel-agent-chat",
        metadata: { thread_id: "abc-123" },
      })
    );
  });
});

describe("CORS", () => {
  it("allows cross-origin requests from the frontend", async () => {
    const { app } = setup([]);
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
