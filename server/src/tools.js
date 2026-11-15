import { tool, ToolMessage } from "langchain";
import { Command } from "@langchain/langgraph";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";

// 1. Web search (Tavily) — used for any travel-related query.
// A factory, so the Tavily API key is only required when the real agent is built.
export const createWebSearch = () =>
  new TavilySearch({
  maxResults: 5,
  topic: "general",
  name: "web_search",
  description:
    "Search the web for up-to-date travel information: destinations, attractions, flights, " +
    "hotels, visas, local events, transport, costs, safety advisories and itineraries. " +
    "Use this for ANY travel-related question.",
  });

// 2. Weather lookup (wttr.in) — current conditions + 3-day forecast for a city.
export const weatherLookup = tool(
  async ({ city }) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const res = await fetch(url, { headers: { "User-Agent": "curl/8.0" } });
    if (!res.ok) return `Could not fetch weather for "${city}" (HTTP ${res.status}).`;
    const data = await res.json();
    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!cur) return `No weather data available for "${city}".`;

    const place = [area?.areaName?.[0]?.value, area?.country?.[0]?.value]
      .filter(Boolean)
      .join(", ");
    const forecast = (data.weather ?? [])
      .map(
        (d) =>
          `- ${d.date}: ${d.mintempC}–${d.maxtempC}°C (${d.mintempF}–${d.maxtempF}°F), ` +
          `${d.hourly?.[4]?.weatherDesc?.[0]?.value ?? "n/a"}, ` +
          `chance of rain ${d.hourly?.[4]?.chanceofrain ?? "?"}%`
      )
      .join("\n");

    return [
      `Weather for ${place || city}:`,
      `Now: ${cur.weatherDesc?.[0]?.value}, ${cur.temp_C}°C (${cur.temp_F}°F), ` +
        `feels like ${cur.FeelsLikeC}°C (${cur.FeelsLikeF}°F), humidity ${cur.humidity}%, ` +
        `wind ${cur.windspeedKmph} km/h ${cur.winddir16Point}.`,
      `Forecast:\n${forecast}`,
    ].join("\n");
  },
  {
    name: "weather_lookup",
    description: "Get the current weather and a 3-day forecast for a given city.",
    schema: z.object({
      city: z.string().describe("City name, e.g. 'Paris' or 'Tokyo, Japan'"),
    }),
  }
);

// 3. Save a user preference into the agent state (persisted by the checkpointer).
export const saveUserPreference = tool(
  async ({ key, value }, runtime) => {
    const current = runtime.state?.preferences ?? {};
    return new Command({
      update: {
        preferences: { ...current, [key]: value },
        messages: [
          new ToolMessage({
            content: `Saved preference: ${key} = ${value}`,
            tool_call_id: runtime.toolCallId,
          }),
        ],
      },
    });
  },
  {
    name: "save_user_preference",
    description:
      "Save a travel preference the user has stated (e.g. budget, home city, travel style, " +
      "dietary needs, preferred airline, temperature unit, interests). Call this whenever the " +
      "user reveals a lasting preference.",
    schema: z.object({
      key: z.string().describe("Short snake_case name, e.g. 'budget', 'home_city', 'diet'"),
      value: z.string().describe("The preference value"),
    }),
  }
);
