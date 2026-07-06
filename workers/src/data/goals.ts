import type { NexusEnv } from "../types";
import { adminDb, userDb, rawQuery, id as newId } from "../instant";
import { DEFAULT_GOAL, mergeGoalUpdate, type GoalFields, type GoalInputT } from "../schema/goal-shapes";
import { todayUtc } from "../lib/dates";
import type { UserCtx } from "./entries";

type GoalRow = {
  id: string;
  calorie_goal: number;
  protein_goal: number;
  carbs_goal?: number;
  fat_goal?: number;
  reason?: string;
  created_at: number | string;
};

function rowToFields(row: GoalRow): GoalFields {
  return {
    calories: row.calorie_goal,
    protein_g: row.protein_goal,
    carbs_g: row.carbs_goal,
    fat_g: row.fat_goal,
  };
}

function dateToEndOfDayMs(yyyyMmDd: string): number {
  // A goal set at any point ON a day is in effect for that whole day, so the
  // cutoff for "latest goal as of this date" is the day's last instant, not
  // its first — otherwise a goal set at 3pm wouldn't apply to that same day.
  return Date.parse(`${yyyyMmDd}T23:59:59.999Z`);
}

/** Set (or partially update) the caller's goal. Always inserts a new row —
 *  see instant.schema.ts for why this is append-only rather than an update. */
export async function setGoal(
  env: NexusEnv,
  user: UserCtx,
  args: GoalInputT,
): Promise<Record<string, unknown>> {
  const scoped = userDb(env, user.email);
  const latest = await rawQuery(scoped, {
    goals: { $: { order: { created_at: "desc" }, limit: 1 } },
  });
  const currentRow = (latest.goals as GoalRow[])[0];
  const merged = mergeGoalUpdate(currentRow ? rowToFields(currentRow) : null, args);

  const db = adminDb(env);
  const goalId = newId();
  await db.transact([
    db.tx.goals[goalId]!
      .update({
        calorie_goal: merged.calories,
        protein_goal: merged.protein_g,
        carbs_goal: merged.carbs_g,
        fat_goal: merged.fat_g,
        reason: args.reason,
        created_at: Date.now(),
      })
      .link({ owner: user.userId }),
  ]);

  return { ...merged, updated: true, effective_from: todayUtc(), reason: args.reason };
}

/** The goal in effect for a given user on a given day: the latest row
 *  created at or before that day's end, or DEFAULT_GOAL if they've never set
 *  one. Takes a plain userId (not UserCtx) so it works the same way for a
 *  friend's day as for the viewer's own — the friendship check that gates
 *  that read already happened by the time this is called. */
export async function getGoalForDate(env: NexusEnv, targetUserId: string, date: string): Promise<GoalFields> {
  const db = adminDb(env);
  const r = await rawQuery(db, {
    goals: {
      $: {
        where: { and: [{ "owner.id": targetUserId }, { created_at: { $lte: dateToEndOfDayMs(date) } }] },
        order: { created_at: "desc" },
        limit: 1,
      },
    },
  });
  const row = (r.goals as GoalRow[])[0];
  return row ? rowToFields(row) : DEFAULT_GOAL;
}
