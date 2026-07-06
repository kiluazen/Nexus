import { z } from "zod";

// Output schemas advertised in tools/list. The MCP SDK validates each tool's
// structuredContent against these (safeParseAsync) and throws on mismatch, so
// they are deliberately lenient: every field optional, nested objects
// passthrough. Zod strips unknown keys rather than rejecting, so extra fields
// the data layer adds later won't break a shipped tool. Their job is to
// describe the shape to the model, not to police the server's own output.

const Totals = z
  .object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
  })
  .partial()
  .passthrough()
  .describe("Summed calories and macros (grams).");

const LoggedItem = z
  .object({
    id: z.string(),
    entry_type: z.enum(["workout", "meal", "weight"]),
    exercise_key: z.string().nullish(),
    total_sets: z.number().optional(),
    duration_min: z.number().optional(),
    meal_type: z.string().nullish(),
    totals: Totals.optional(),
    weight_kg: z.number().optional(),
  })
  .partial()
  .passthrough();

const Workout = z.object({ id: z.string(), date: z.string() }).partial().passthrough();
const Meal = z
  .object({
    id: z.string(),
    date: z.string(),
    meal_type: z.string().nullish(),
    items: z.array(z.any()),
    totals: Totals,
    notes: z.string(),
  })
  .partial()
  .passthrough();
const Weight = z
  .object({ id: z.string(), date: z.string(), weight_kg: z.number() })
  .partial()
  .passthrough();

const DayTotals = z
  .object({
    exercises: z.number(),
    total_sets: z.number(),
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    meals_logged: z.number(),
  })
  .partial()
  .passthrough()
  .describe("Single-day rollup, present only when the query is one day.");

const Goal = z
  .object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number().optional(),
    fat_g: z.number().optional(),
  })
  .partial()
  .passthrough()
  .describe("The calorie/protein/carb/fat goal in effect on the queried day (defaults apply until the user sets one).");

// Shared "a day (or range) of history" shape. Both the history read and the
// log write return this (log adds `logged`), so the widget always has a full
// card regardless of which tool produced it.
const historyShape = {
  period: z.object({ from: z.string(), to: z.string() }).partial().passthrough().optional(),
  workouts: z.array(Workout).optional(),
  meals: z.array(Meal).optional(),
  weights: z.array(Weight).optional(),
  your_exercises: z
    .array(z.string())
    .optional()
    .describe("Distinct exercise_key values, reuse these so progressions cluster."),
  pending_friend_requests: z.number().optional(),
  day_totals: DayTotals.optional(),
  goal: Goal.optional(),
} as const;

export const HistoryOutput = z.object(historyShape);

export const LogOutput = z.object({
  logged: z
    .array(LoggedItem)
    .optional()
    .describe("One row per entry just written, each with its new id."),
  ...historyShape,
});

export const UpdateOutput = z.object({
  id: z.string(),
  entry_type: z.enum(["workout", "meal", "weight"]),
  updated: z.boolean(),
  exercise_key: z.string().nullish(),
  total_sets: z.number().optional(),
  duration_min: z.number().optional(),
  totals: Totals.optional(),
  items_count: z.number().optional(),
  weight_kg: z.number().optional(),
});

export const GoalOutput = z
  .object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number().optional(),
    fat_g: z.number().optional(),
    reason: z.string().optional(),
    effective_from: z.string(),
    updated: z.boolean(),
  })
  .partial()
  .passthrough();

// manageFriends returns different shapes per action (list vs add vs
// accept/reject/remove). One permissive object covers them all.
export const FriendsOutput = z
  .object({
    your_code: z.string().optional(),
    friends: z.array(z.any()).optional(),
    pending_received: z.array(z.any()).optional(),
    pending_sent: z.array(z.any()).optional(),
    status: z.string().optional(),
    with: z.string().optional(),
    to: z.string().optional(),
    friend: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();
