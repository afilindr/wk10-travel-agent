import { tool } from "langchain";
import { z } from "zod";

/** Minimal wttr.in `?format=j1` payload. */
export const wttrFixture = {
  current_condition: [
    {
      temp_C: "18",
      temp_F: "64",
      FeelsLikeC: "17",
      FeelsLikeF: "63",
      humidity: "60",
      windspeedKmph: "12",
      winddir16Point: "NW",
      weatherDesc: [{ value: "Partly cloudy" }],
    },
  ],
  nearest_area: [{ areaName: [{ value: "Lisbon" }], country: [{ value: "Portugal" }] }],
  weather: [
    {
      date: "2026-11-15",
      mintempC: "12",
      maxtempC: "19",
      mintempF: "54",
      maxtempF: "66",
      hourly: Array.from({ length: 8 }, () => ({
        weatherDesc: [{ value: "Sunny" }],
        chanceofrain: "10",
      })),
    },
  ],
};

/** Stand-in for the Tavily tool: same name, records its queries, no network. */
export function createFakeWebSearch() {
  const queries = [];
  const fake = tool(
    async ({ query }) => {
      queries.push(query);
      return JSON.stringify({
        results: [{ title: "Lisbon travel guide", url: "https://example.com/lisbon", content: "Visit Alfama." }],
      });
    },
    {
      name: "web_search",
      description: "Search the web for travel information.",
      schema: z.object({ query: z.string() }),
    }
  );
  return { tool: fake, queries };
}
