import { z } from "zod";
import { ValidationError } from "../lib/dates";

const WorkoutSet = z.object({
  weight_kg: z.number().optional(),
  reps: z.number().int().optional(),
}).strict();

const WorkoutEntryShape = z.object({
  type: z.literal("workout"),
  exercise: z.string().trim().min(1),
  exercise_key: z.string().trim().min(1).regex(
    /^[a-z0-9_]+$/,
    "exercise_key must be lowercase_with_underscores",
  ),
  sets: z.array(WorkoutSet).optional(),
  duration_min: z.number().nonnegative().optional(),
  distance_km: z.number().nonnegative().optional(),
  notes: z.string().optional(),
}).strict();

const MealItem = z.object({
  name: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
}).strict();

const MealEntryShape = z.object({
  type: z.literal("meal"),
  meal_type: z.string().optional(),
  items: z.array(MealItem).min(1),
  totals: z.object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
  }).optional(),
  notes: z.string().optional(),
}).strict();

const WeightEntryShape = z.object({
  type: z.literal("weight"),
  weight_kg: z.number().positive(),
  notes: z.string().optional(),
}).strict();

export const EntryShape = z.discriminatedUnion("type", [
  WorkoutEntryShape,
  MealEntryShape,
  WeightEntryShape,
]);

// --- Model-facing INPUT schema (what nexus_log_entries publishes) -----------
// FLAT, on purpose. The model naturally logs a meal as one object with top-level
// macros; forcing it into a nested items[] array was the cause of the retries.
// This is the single canonical shape (no type/kind alias, no accept-anything).
// Unknown extra keys are stripped (Zod default). Missing macros default to 0 —
// the card lets the user correct the estimate. It maps to storage server-side.
const MealInput = z.object({
  type: z.literal("meal"),
  name: z.string().trim().min(1).describe("What was eaten or drunk, e.g. 'Cappuccino' or 'Chicken rice bowl'"),
  calories: z.number().nonnegative().describe("Total calories (kcal) you estimated for this item"),
  protein_g: z.number().nonnegative().optional().describe("Protein in grams (omit if unknown)"),
  carbs_g: z.number().nonnegative().optional().describe("Carbs in grams (omit if unknown)"),
  fat_g: z.number().nonnegative().optional().describe("Fat in grams (omit if unknown)"),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional().describe("Which meal, if clear from context"),
});

const WorkoutInput = z.object({
  type: z.literal("workout"),
  exercise: z.string().trim().min(1).describe("Exercise name, e.g. 'Bench Press'"),
  exercise_key: z.string().trim().min(1).regex(/^[a-z0-9_]+$/, "lowercase_with_underscores")
    .describe("Stable lowercase_with_underscores key, e.g. 'bench_press'. Reuse the same key for the same exercise so progress clusters."),
  sets: z.array(WorkoutSet).optional().describe("One entry per set, each with weight_kg and reps"),
  duration_min: z.number().nonnegative().optional(),
  distance_km: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const WeightInput = z.object({
  type: z.literal("weight"),
  weight_kg: z.number().positive().describe("Body weight in kilograms"),
  notes: z.string().optional(),
});

export const EntryInput = z.discriminatedUnion("type", [MealInput, WorkoutInput, WeightInput]);
export type EntryInputT = z.infer<typeof EntryInput>;

/** Validate one model-supplied entry against the flat input schema. */
export function parseEntryInput(raw: unknown): EntryInputT {
  const r = EntryInput.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path?.length ? ` at ${issue.path.join(".")}` : "";
    throw new ValidationError(`Invalid entry${path}: ${issue?.message ?? "unknown"}`);
  }
  return r.data;
}

export interface StorageEntry {
  type: "meal" | "workout" | "weight";
  exercise_key: string | null;
  meal_type: string | null;
  data: Record<string, unknown>;
}

/** Map a flat input entry to the stored data shape (meals become a single
 *  summary item + totals; workouts/weights pass through). */
export function entryInputToStorage(e: EntryInputT): StorageEntry {
  if (e.type === "meal") {
    const totals = computeMealTotals([{
      calories: e.calories,
      protein_g: e.protein_g ?? 0,
      carbs_g: e.carbs_g ?? 0,
      fat_g: e.fat_g ?? 0,
    }]);
    return {
      type: "meal",
      exercise_key: null,
      meal_type: e.meal_type ?? null,
      data: { meal_type: e.meal_type, items: [{ name: e.name, quantity: 1, ...totals }], totals },
    };
  }
  if (e.type === "workout") {
    const key = e.exercise_key.trim();
    return {
      type: "workout",
      exercise_key: key,
      meal_type: null,
      data: {
        exercise: e.exercise, exercise_key: key, sets: e.sets,
        duration_min: e.duration_min, distance_km: e.distance_km, notes: e.notes,
      },
    };
  }
  return { type: "weight", exercise_key: null, meal_type: null, data: { weight_kg: e.weight_kg, notes: e.notes } };
}

export type Entry = z.infer<typeof EntryShape>;
export type WorkoutEntry = z.infer<typeof WorkoutEntryShape>;
export type MealEntry = z.infer<typeof MealEntryShape>;
export type WeightEntry = z.infer<typeof WeightEntryShape>;

export interface MealTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export function computeMealTotals(items: { calories: number; protein_g: number; carbs_g: number; fat_g: number }[]): MealTotals {
  const totals: MealTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) {
    totals.calories  += it.calories;
    totals.protein_g += it.protein_g;
    totals.carbs_g   += it.carbs_g;
    totals.fat_g     += it.fat_g;
  }
  return {
    calories:  Math.round(totals.calories  * 10) / 10,
    protein_g: Math.round(totals.protein_g * 10) / 10,
    carbs_g:   Math.round(totals.carbs_g   * 10) / 10,
    fat_g:     Math.round(totals.fat_g     * 10) / 10,
  };
}

export function parseEntry(raw: unknown): Entry {
  const r = EntryShape.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path?.length ? ` at ${issue.path.join(".")}` : "";
    throw new ValidationError(`Invalid entry${path}: ${issue?.message ?? "unknown"}`);
  }
  return r.data;
}
