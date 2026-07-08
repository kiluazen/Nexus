import { type Request, type Response, Router } from "express";
import { McpServer } from "skybridge/server";
import * as z from "zod";

// Widget CSP — same shape Nexus ships today (InstantDB live sync). Kept here so
// the trial mirrors the production _meta; the trial itself renders purely from
// front-loaded structuredContent, so it doesn't actually need the connect
// domains yet.
const WIDGET_CSP = {
  connectDomains: ["https://api.instantdb.com", "wss://api.instantdb.com"],
};

// A realistic day so the card paints immediately in DevTools — this is the
// front-loading pattern: everything the widget renders comes back in
// structuredContent, no network round-trip on first paint.
function mockDay() {
  return {
    period: { from: "2026-07-08", to: "2026-07-08" },
    goal: { calories: 2100, protein_g: 120 },
    meals: [
      {
        id: "m1",
        meal_type: "Breakfast",
        items: [{ name: "2 boiled eggs", quantity: 1, calories: 140, protein_g: 12, carbs_g: 1, fat_g: 10 }],
        totals: { calories: 140, protein_g: 12, carbs_g: 1, fat_g: 10 },
      },
      {
        id: "m2",
        meal_type: "Lunch",
        items: [{ name: "Chicken rice bowl", quantity: 1, calories: 620, protein_g: 45, carbs_g: 68, fat_g: 16 }],
        totals: { calories: 620, protein_g: 45, carbs_g: 68, fat_g: 16 },
      },
      {
        id: "m3",
        meal_type: "Snack",
        items: [{ name: "Ghirardelli Dark Chocolate Mint Square", quantity: 1, calories: 70, protein_g: 1, carbs_g: 8, fat_g: 4 }],
        totals: { calories: 70, protein_g: 1, carbs_g: 8, fat_g: 4 },
      },
    ],
    workouts: [
      {
        id: "w1",
        exercise: "Bench Press",
        exercise_key: "bench_press",
        sets: [
          { weight_kg: 60, reps: 8 },
          { weight_kg: 65, reps: 6 },
          { weight_kg: 65, reps: 5 },
        ],
      },
      {
        id: "w2",
        exercise: "Lat Pulldown",
        exercise_key: "lat_pulldown",
        sets: [
          { weight_kg: 50, reps: 10 },
          { weight_kg: 55, reps: 8 },
        ],
      },
    ],
    weights: [{ weight_kg: 74.2 }],
  };
}

function formatForModel(day: ReturnType<typeof mockDay>): string {
  const kcal = day.meals.reduce((s, m) => s + m.totals.calories, 0);
  const protein = day.meals.reduce((s, m) => s + m.totals.protein_g, 0);
  return [
    `Today: ${kcal} kcal of ${day.goal.calories}, ${protein}g protein of ${day.goal.protein_g}.`,
    `${day.meals.length} meals, ${day.workouts.length} workouts logged.`,
  ].join("\n");
}

const server = new McpServer(
  {
    name: "nexus-widget-trial",
    version: "0.0.1",
  },
  { capabilities: {} },
)
  .registerTool(
    {
      name: "nexus_view_today",
      description:
        "Show today's Nexus card — logged meals, workouts, calories, and protein against the day's goals.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      view: {
        component: "nexus-today",
        description: "Nexus day card: calorie ring, protein bar, meal list, workout view.",
        csp: WIDGET_CSP,
      },
      _meta: {
        "openai/widgetAccessible": true,
        "openai/widgetPrefersBorder": true,
      },
    },
    async () => {
      const day = mockDay();
      return {
        structuredContent: day,
        content: [{ type: "text", text: formatForModel(day) }],
        isError: false,
      };
    },
  )
  .registerTool(
    {
      name: "nexus_update_entry",
      description: "Edit a logged meal's name or macros.",
      inputSchema: {
        entry_id: z.string(),
        data: z.object({
          items: z.array(z.record(z.string(), z.unknown())).optional(),
          totals: z.record(z.string(), z.number()).optional(),
          meal_type: z.string().optional(),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { "openai/widgetAccessible": true },
    },
    async ({ entry_id, data }) => {
      // Trial stub: echoes success. The widget updates optimistically; in
      // production this writes to InstantDB and the live query reflects it.
      return {
        structuredContent: { ok: true, entry_id, data },
        content: [{ type: "text", text: `Updated ${entry_id}.` }],
        isError: false,
      };
    },
  );

const router = Router();
router.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});
server.use(router);

export default await server.run();

export type AppType = typeof server;
