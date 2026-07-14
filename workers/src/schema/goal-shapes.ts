import { z } from "zod";

// Same macro vocabulary the model already uses for meals (LogInput's
// calories/protein_g/carbs_g/fat_g) so setting a goal doesn't require it to
// learn a second naming convention.
export const GoalInput = z.object({
  mutation_id: z.string().min(8).max(128).describe(
    "A unique id for this intended goal change. Reuse it only when retrying the same change.",
  ),
  calories:  z.number().nonnegative().optional().describe("Daily calorie goal (kcal)"),
  protein_g: z.number().nonnegative().optional().describe("Daily protein goal (grams)"),
  carbs_g:   z.number().nonnegative().optional().describe("Daily carbs goal (grams)"),
  fat_g:     z.number().nonnegative().optional().describe("Daily fat goal (grams)"),
  reason:    z.string().optional().describe("Why the goal is changing, e.g. 'cutting for summer' — stored for context, shown in history"),
});
export type GoalInputT = z.infer<typeof GoalInput>;
export type GoalPatch = Omit<GoalInputT, "mutation_id">;

export interface GoalFields {
  calories: number;
  protein_g: number;
  carbs_g?: number;
  fat_g?: number;
}

// Every user starts here until they (via the model) ever set a goal.
export const DEFAULT_GOAL: GoalFields = { calories: 2100, protein_g: 120 };

/** Fold a partial goal update onto whatever's currently in effect (or the
 *  default, for a user who's never set one). Never drops a field the caller
 *  didn't mention — "just bump protein to 150" must not blank out calories —
 *  which is what makes every stored row complete, so "the goal on date X" is
 *  always a single self-contained row, never a patch you have to replay. */
export function mergeGoalUpdate(current: GoalFields | null, patch: GoalPatch): GoalFields {
  const base = current ?? DEFAULT_GOAL;
  return {
    calories:  patch.calories ?? base.calories,
    protein_g: patch.protein_g ?? base.protein_g,
    carbs_g:   patch.carbs_g ?? base.carbs_g,
    fat_g:     patch.fat_g ?? base.fat_g,
  };
}
