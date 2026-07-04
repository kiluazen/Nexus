import type { NexusEnv } from "../types";
import { adminDb, userDb, rawQuery, id as newId } from "../instant";
import {
  computeMealTotals,
  parseEntry,
  type Entry,
  type MealTotals,
} from "../schema/entry-shapes";
import { ValidationError, parseDate, todayUtc, addDaysUtc } from "../lib/dates";

export interface UserCtx {
  userId: string;
  email: string;
  displayName: string;
}

// entry_date is an InstantDB i.date() — store UTC-midnight epoch ms, render
// back to YYYY-MM-DD at the edge.
function dateToMs(yyyyMmDd: string): number {
  return Date.parse(`${yyyyMmDd}T00:00:00Z`);
}

function msToDate(value: number | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

type EntryRow = {
  id: string;
  type: string;
  entry_date: number | string;
  exercise_key?: string;
  meal_type?: string;
  data: Record<string, unknown>;
  created_at: number | string;
  updated_at: number | string;
};

export async function logEntries(
  env: NexusEnv,
  user: UserCtx,
  args: { entries: unknown[]; date?: string },
): Promise<{ logged: unknown[] }> {
  const entryDate = parseDate(args.date);
  const dateMs = dateToMs(entryDate);
  const now = Date.now();

  // Writes go through the admin client: the owner link comes from the
  // authenticated props, never from tool input, so ownership is decided
  // server-side by construction.
  const db = adminDb(env);
  const chunks = [];
  const logged: Record<string, unknown>[] = [];

  for (const raw of args.entries) {
    const entry = parseEntry({ ...((raw as object) ?? {}) });
    const entryId = newId();

    if (entry.type === "workout") {
      const { type: _t, ...data } = entry;
      const exerciseKey = data.exercise_key.trim();
      chunks.push(
        db.tx.entries[entryId]!
          .update({
            type: "workout",
            entry_date: dateMs,
            exercise_key: exerciseKey,
            data,
            created_at: now,
            updated_at: now,
          })
          .link({ owner: user.userId }),
      );
      const out: Record<string, unknown> = {
        id: entryId,
        entry_type: "workout",
        exercise_key: exerciseKey,
      };
      if (Array.isArray(data.sets)) out.total_sets = data.sets.length;
      if (typeof data.duration_min === "number") out.duration_min = data.duration_min;
      logged.push(out);
    } else if (entry.type === "meal") {
      const { type: _t, ...rest } = entry;
      const totals = computeMealTotals(rest.items);
      const data = { ...rest, totals };
      chunks.push(
        db.tx.entries[entryId]!
          .update({
            type: "meal",
            entry_date: dateMs,
            meal_type: data.meal_type,
            data,
            created_at: now,
            updated_at: now,
          })
          .link({ owner: user.userId }),
      );
      logged.push({
        id: entryId,
        entry_type: "meal",
        meal_type: data.meal_type ?? null,
        totals,
        items_count: data.items.length,
      });
    } else {
      const { type: _t, ...data } = entry;
      chunks.push(
        db.tx.entries[entryId]!
          .update({
            type: "weight",
            entry_date: dateMs,
            data,
            created_at: now,
            updated_at: now,
          })
          .link({ owner: user.userId }),
      );
      logged.push({ id: entryId, entry_type: "weight", weight_kg: data.weight_kg });
    }
  }

  if (chunks.length > 0) await db.transact(chunks);
  return { logged };
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
  let fromDate: string;
  let toDate: string;
  if (args.date) {
    fromDate = toDate = parseDate(args.date);
  } else if (args.from_date || args.to_date) {
    fromDate = args.from_date ? parseDate(args.from_date) : parseDate(args.to_date);
    toDate = args.to_date ? parseDate(args.to_date) : parseDate(args.from_date);
  } else {
    toDate = todayUtc();
    fromDate = addDaysUtc(toDate, -6);
  }

  const whereRange: Record<string, unknown>[] = [
    { entry_date: { $gte: dateToMs(fromDate) } },
    { entry_date: { $lte: dateToMs(toDate) } },
  ];
  if (args.type) whereRange.push({ type: args.type });

  let rows: EntryRow[];
  // For own reads we also need the exercise-key list and pending-request count.
  // They're independent of the entries query, so fire all three together —
  // sequential InstantDB calls are ~400ms each and stack up otherwise.
  let exerciseKeys: string[] = [];
  let pendingCount = 0;

  if (args.friend_id) {
    // Friend reads bypass the CEL rules on purpose, gated by an explicit
    // friendship check right here. The check must precede the read, so these
    // two stay sequential.
    const db = adminDb(env);
    const f = await rawQuery(db, {
      friendships: {
        $: {
          where: {
            status: "active",
            or: [
              { and: [{ "requester.id": user.userId }, { "addressee.id": args.friend_id }] },
              { and: [{ "requester.id": args.friend_id }, { "addressee.id": user.userId }] },
            ],
          },
        },
      },
    });
    if (f.friendships.length === 0) throw new ValidationError("Not friends with this user.");
    const r = await rawQuery(db, {
      entries: {
        $: {
          where: { and: [{ "owner.id": args.friend_id }, ...whereRange] },
          order: { entry_date: "desc" },
        },
      },
    });
    rows = r.entries as unknown as EntryRow[];
  } else {
    // Own reads run permission-scoped: instant.perms.ts is the enforcement.
    const scoped = userDb(env, user.email);
    const [entriesRes, exRes, pendingRes] = await Promise.all([
      rawQuery(scoped, {
        entries: { $: { where: { and: whereRange }, order: { entry_date: "desc" } } },
      }),
      // Newest first so a heavy user's recent exercises stay in the window.
      rawQuery(scoped, {
        entries: {
          $: {
            where: { type: "workout" },
            fields: ["exercise_key"],
            order: { created_at: "desc" },
            limit: 500,
          },
        },
      }),
      rawQuery(scoped, {
        friendships: { $: { where: { "addressee.id": user.userId, status: "pending" } } },
      }),
    ]);
    rows = entriesRes.entries as unknown as EntryRow[];
    const keys = new Set<string>();
    for (const row of exRes.entries as { exercise_key?: string }[]) {
      if (row.exercise_key) keys.add(row.exercise_key);
    }
    exerciseKeys = [...keys].sort();
    pendingCount = pendingRes.friendships.length;
  }

  const workouts: Record<string, unknown>[] = [];
  const meals: Record<string, unknown>[] = [];
  const weights: Record<string, unknown>[] = [];

  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const base = { id: row.id, date: msToDate(row.entry_date) };
    if (row.type === "workout") {
      workouts.push({ ...base, ...data });
    } else if (row.type === "meal") {
      const m: Record<string, unknown> = {
        ...base,
        meal_type: data.meal_type ?? null,
        items: data.items ?? [],
        totals: data.totals ?? {},
      };
      if (data.notes) m.notes = data.notes;
      meals.push(m);
    } else if (row.type === "weight") {
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
      meals.reduce((acc, m) => acc + ((m.totals as MealTotals | undefined)?.[key] ?? 0), 0);
    result.day_totals = {
      exercises: workouts.length,
      total_sets: totalSets,
      calories: Math.round(sumT("calories") * 10) / 10,
      protein_g: Math.round(sumT("protein_g") * 10) / 10,
      carbs_g: Math.round(sumT("carbs_g") * 10) / 10,
      fat_g: Math.round(sumT("fat_g") * 10) / 10,
      meals_logged: meals.length,
    };
  }

  return result;
}

export async function updateEntry(
  env: NexusEnv,
  user: UserCtx,
  args: { entry_id: string; data: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  // Ownership check runs permission-scoped: if the entry belongs to someone
  // else, the scoped query simply can't see it.
  const scoped = userDb(env, user.email);
  const existing = await scoped.query({
    entries: { $: { where: { id: args.entry_id } } },
  });
  const row = existing.entries[0] as EntryRow | undefined;
  if (!row) {
    throw new ValidationError(`Entry ${args.entry_id} not found or not owned by you.`);
  }
  const entryType = row.type as "workout" | "meal" | "weight";

  const reconstructed = { type: entryType, ...args.data };
  const entry = parseEntry(reconstructed);

  let patch: Record<string, unknown>;
  let storedData: Record<string, unknown>;
  if (entry.type === "workout") {
    const { type: _t, ...d } = entry;
    storedData = d;
    patch = { exercise_key: d.exercise_key.trim(), data: d, updated_at: Date.now() };
  } else if (entry.type === "meal") {
    const { type: _t, ...d } = entry;
    storedData = { ...d, totals: computeMealTotals(d.items) };
    patch = { meal_type: d.meal_type, data: storedData, updated_at: Date.now() };
  } else {
    const { type: _t, ...d } = entry;
    storedData = d;
    patch = { data: d, updated_at: Date.now() };
  }

  const db = adminDb(env);
  await db.transact([db.tx.entries[args.entry_id]!.update(patch)]);

  const result: Record<string, unknown> = {
    id: args.entry_id,
    entry_type: entryType,
    updated: true,
  };
  if (entryType === "workout") {
    result.exercise_key = (patch.exercise_key as string) ?? null;
    const sets = (storedData as { sets?: unknown[] }).sets;
    if (Array.isArray(sets)) result.total_sets = sets.length;
    const dur = (storedData as { duration_min?: number }).duration_min;
    if (typeof dur === "number") result.duration_min = dur;
  } else if (entryType === "meal") {
    result.totals = (storedData as { totals: MealTotals }).totals;
    result.items_count = ((storedData as { items: unknown[] }).items ?? []).length;
  } else {
    result.weight_kg = (storedData as { weight_kg: number }).weight_kg;
  }
  return result;
}
