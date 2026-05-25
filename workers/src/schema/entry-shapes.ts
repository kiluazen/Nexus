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
