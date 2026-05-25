import type { NexusEnv } from "../types";
import { withClient } from "./db";
import {
  computeMealTotals,
  parseEntry,
  type Entry,
  type MealTotals,
} from "../schema/entry-shapes";
import { ValidationError, parseDate, todayUtc, addDaysUtc } from "../lib/dates";

interface UserCtx {
  userId: string;
  displayName: string;
}

export async function ensureUser(env: NexusEnv, u: UserCtx): Promise<void> {
  await withClient(env, async (c) => {
    await c.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [u.userId, u.displayName],
    );
  });
}

export async function logEntries(
  env: NexusEnv,
  user: UserCtx,
  args: { entries: unknown[]; date?: string },
): Promise<{ logged: unknown[] }> {
  const entryDate = parseDate(args.date);
  return withClient(env, async (c) => {
    await c.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [user.userId, user.displayName],
    );

    const results: unknown[] = [];
    for (const raw of args.entries) {
      const entry = parseEntry({ ...((raw as object) ?? {}) });
      if (entry.type === "workout") {
        results.push(await insertWorkout(c, user.userId, entryDate, entry));
      } else if (entry.type === "meal") {
        results.push(await insertMeal(c, user.userId, entryDate, entry));
      } else {
        results.push(await insertWeight(c, user.userId, entryDate, entry));
      }
    }
    return { logged: results };
  });
}

async function insertWorkout(
  c: import("pg").Client,
  userId: string,
  date: string,
  entry: Extract<Entry, { type: "workout" }>,
): Promise<Record<string, unknown>> {
  const { type: _t, ...data } = entry;
  const exerciseKey = data.exercise_key.trim();
  const r = await c.query<{ id: number }>(
    `INSERT INTO entries (user_id, entry_type, date, exercise_key, data)
     VALUES ($1, 'workout', $2::date, $3, $4::jsonb)
     RETURNING id`,
    [userId, date, exerciseKey, JSON.stringify(data)],
  );
  const out: Record<string, unknown> = {
    id: r.rows[0]!.id,
    entry_type: "workout",
    exercise_key: exerciseKey,
  };
  if (Array.isArray(data.sets)) out.total_sets = data.sets.length;
  if (typeof data.duration_min === "number") out.duration_min = data.duration_min;
  return out;
}

async function insertMeal(
  c: import("pg").Client,
  userId: string,
  date: string,
  entry: Extract<Entry, { type: "meal" }>,
): Promise<Record<string, unknown>> {
  const { type: _t, ...rest } = entry;
  const totals = computeMealTotals(rest.items);
  const data = { ...rest, totals };
  const r = await c.query<{ id: number }>(
    `INSERT INTO entries (user_id, entry_type, date, exercise_key, data)
     VALUES ($1, 'meal', $2::date, NULL, $3::jsonb)
     RETURNING id`,
    [userId, date, JSON.stringify(data)],
  );
  return {
    id: r.rows[0]!.id,
    entry_type: "meal",
    meal_type: data.meal_type ?? null,
    totals,
    items_count: data.items.length,
  };
}

async function insertWeight(
  c: import("pg").Client,
  userId: string,
  date: string,
  entry: Extract<Entry, { type: "weight" }>,
): Promise<Record<string, unknown>> {
  const { type: _t, ...data } = entry;
  const r = await c.query<{ id: number }>(
    `INSERT INTO entries (user_id, entry_type, date, exercise_key, data)
     VALUES ($1, 'weight', $2::date, NULL, $3::jsonb)
     RETURNING id`,
    [userId, date, JSON.stringify(data)],
  );
  return { id: r.rows[0]!.id, entry_type: "weight", weight_kg: data.weight_kg };
}

export async function getHistory(
  env: NexusEnv,
  user: UserCtx,
  args: {
    date?: string;
    from_date?: string;
    to_date?: string;
    type?: "workout" | "meal" | "weight";
    friend_id?: string;
  },
): Promise<Record<string, unknown>> {
  return withClient(env, async (c) => {
    await c.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [user.userId, user.displayName],
    );

    let queryUserId = user.userId;
    if (args.friend_id) {
      const f = await c.query(
        `SELECT 1 FROM friendships WHERE status = 'active'
         AND ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1))
         LIMIT 1`,
        [user.userId, args.friend_id],
      );
      if (f.rows.length === 0) throw new ValidationError("Not friends with this user.");
      queryUserId = args.friend_id;
    }

    let fromDate: string;
    let toDate: string;
    if (args.date) {
      fromDate = toDate = parseDate(args.date);
    } else if (args.from_date || args.to_date) {
      fromDate = args.from_date ? parseDate(args.from_date) : parseDate(args.to_date);
      toDate   = args.to_date   ? parseDate(args.to_date)   : parseDate(args.from_date);
    } else {
      toDate = todayUtc();
      fromDate = addDaysUtc(toDate, -6);
    }

    const params: unknown[] = [queryUserId, fromDate, toDate];
    let typeClause = "";
    if (args.type) {
      params.push(args.type);
      typeClause = ` AND entry_type = $${params.length}`;
    }

    const r = await c.query<{
      id: number;
      entry_type: string;
      date: string;
      exercise_key: string | null;
      data: string;
    }>(
      `SELECT id, entry_type, date::text AS date, exercise_key, data::text AS data
       FROM entries
       WHERE user_id = $1 AND date >= $2::date AND date <= $3::date${typeClause}
       ORDER BY date DESC, id DESC`,
      params,
    );

    let exerciseKeys: string[] = [];
    let pendingCount = 0;
    if (!args.friend_id) {
      const ek = await c.query<{ exercise_key: string }>(
        `SELECT DISTINCT exercise_key FROM entries
         WHERE user_id = $1 AND exercise_key IS NOT NULL
         ORDER BY exercise_key`,
        [user.userId],
      );
      exerciseKeys = ek.rows.map((row) => row.exercise_key);
      const pc = await c.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM friendships
         WHERE recipient_id = $1 AND status = 'pending'`,
        [user.userId],
      );
      pendingCount = parseInt(pc.rows[0]?.count ?? "0", 10);
    }

    const workouts: Record<string, unknown>[] = [];
    const meals: Record<string, unknown>[] = [];
    const weights: Record<string, unknown>[] = [];

    for (const row of r.rows) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      const base = { id: row.id, date: row.date };
      if (row.entry_type === "workout") {
        workouts.push({ ...base, ...data });
      } else if (row.entry_type === "meal") {
        const m: Record<string, unknown> = {
          ...base,
          meal_type: data.meal_type ?? null,
          items: data.items ?? [],
          totals: data.totals ?? {},
        };
        if (data.notes) m.notes = data.notes;
        meals.push(m);
      } else if (row.entry_type === "weight") {
        weights.push({ ...base, ...data });
      }
    }

    const result: Record<string, unknown> = {
      period: { from: fromDate, to: toDate },
      workouts,
      meals,
      weights,
    };

    if (!args.friend_id) {
      result.your_exercises = exerciseKeys;
      if (pendingCount > 0) result.pending_friend_requests = pendingCount;
    }

    if (fromDate === toDate) {
      let totalSets = 0;
      for (const w of workouts) {
        const sets = (w as { sets?: unknown[] }).sets;
        if (Array.isArray(sets)) totalSets += sets.length;
      }
      const sumT = (key: keyof MealTotals): number =>
        meals.reduce((acc, m) => acc + (((m.totals as MealTotals | undefined)?.[key]) ?? 0), 0);
      result.day_totals = {
        exercises: workouts.length,
        total_sets: totalSets,
        calories:  Math.round(sumT("calories")  * 10) / 10,
        protein_g: Math.round(sumT("protein_g") * 10) / 10,
        carbs_g:   Math.round(sumT("carbs_g")   * 10) / 10,
        fat_g:     Math.round(sumT("fat_g")     * 10) / 10,
        meals_logged: meals.length,
      };
    }

    return result;
  });
}

export async function updateEntry(
  env: NexusEnv,
  user: UserCtx,
  args: { entry_id: number; data: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  return withClient(env, async (c) => {
    await c.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [user.userId, user.displayName],
    );

    const existing = await c.query<{ entry_type: string }>(
      `SELECT entry_type FROM entries WHERE id = $1 AND user_id = $2`,
      [args.entry_id, user.userId],
    );
    if (existing.rows.length === 0) {
      throw new ValidationError(`Entry ${args.entry_id} not found or not owned by you.`);
    }
    const entryType = existing.rows[0]!.entry_type as "workout" | "meal" | "weight";

    const reconstructed = { type: entryType, ...args.data };
    const entry = parseEntry(reconstructed);

    let newExerciseKey: string | null = null;
    let storedData: Record<string, unknown>;
    if (entry.type === "workout") {
      const { type: _t, ...d } = entry;
      newExerciseKey = d.exercise_key.trim();
      storedData = d;
    } else if (entry.type === "meal") {
      const { type: _t, ...d } = entry;
      storedData = { ...d, totals: computeMealTotals(d.items) };
    } else {
      const { type: _t, ...d } = entry;
      storedData = d;
    }

    await c.query(
      `UPDATE entries
       SET data = $1::jsonb, exercise_key = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      [JSON.stringify(storedData), newExerciseKey, args.entry_id, user.userId],
    );

    const result: Record<string, unknown> = {
      id: args.entry_id,
      entry_type: entryType,
      updated: true,
    };
    if (entryType === "workout") {
      result.exercise_key = newExerciseKey;
      const sets = (storedData as { sets?: unknown[] }).sets;
      if (Array.isArray(sets)) result.total_sets = sets.length;
      const dur = (storedData as { duration_min?: number }).duration_min;
      if (typeof dur === "number") result.duration_min = dur;
    } else if (entryType === "meal") {
      result.totals = (storedData as { totals: MealTotals }).totals;
      result.items_count = ((storedData as { items: unknown[] }).items ?? []).length;
    } else if (entryType === "weight") {
      result.weight_kg = (storedData as { weight_kg: number }).weight_kg;
    }
    return result;
  });
}
