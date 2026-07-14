import type { NexusEnv } from "../types";
import { adminDb, userDb, rawQuery } from "../instant";
import {
  computeMealTotals,
  parseEntry,
  parseEntryInput,
  entryInputToStorage,
  type MealTotals,
  type EntryUpdateDataInput,
} from "../schema/entry-shapes";
import { ValidationError, parseDate, todayUtc, addDaysUtc } from "../lib/dates";
import { getGoalForDate } from "./goals";
import { exerciseUpsertChunks } from "./exercises";
import type { ExerciseCatalogInput } from "../schema/entry-shapes";
import { deterministicMutationId, prepareMutation, receiptChunk } from "./mutations";

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
  version?: string;
};

export async function logEntries(
  env: NexusEnv,
  user: UserCtx,
  args: { mutation_id: string; entries: unknown[]; date?: string },
): Promise<{ logged: unknown[] }> {
  const prepared = await prepareMutation(env, user, "nexus_log_entries", args.mutation_id, args);
  if (prepared.replay) return prepared.replay as { logged: unknown[] };
  const entryDate = parseDate(args.date);
  const dateMs = dateToMs(entryDate);
  const now = Date.now();

  // Writes go through the admin client: the owner link comes from the
  // authenticated props, never from tool input, so ownership is decided
  // server-side by construction.
  const db = adminDb(env);
  // InstantDB's generated chunk type is entity-specific, while one atomic
  // transaction intentionally spans entries, catalogue rows, and a receipt.
  const chunks: Array<ReturnType<typeof receiptChunk> | ReturnType<typeof db.tx.entries[string]["update"]>> = [];
  const logged: Record<string, unknown>[] = [];
  const catalogItems: ExerciseCatalogInput[] = [];

  for (let index = 0; index < args.entries.length; index++) {
    const raw = args.entries[index];
    // Validate against the flat, published input schema, then map to storage.
    const entry = parseEntryInput({ ...((raw as object) ?? {}) });
    const s = entryInputToStorage(entry);
    const entryId = await deterministicMutationId(prepared.receiptId, "entry", String(index));
    const version = await deterministicMutationId(prepared.receiptId, "entry-version", String(index));

    chunks.push(
      db.tx.entries[entryId]!
        .update({
          type: s.type,
          entry_date: dateMs,
          exercise_key: s.exercise_key ?? undefined,
          meal_type: s.meal_type ?? undefined,
          data: s.data,
          created_at: now,
          updated_at: now,
          version,
        })
        .link({ owner: user.userId }),
    );

    if (s.type === "workout") {
      if (s.catalog) catalogItems.push(s.catalog);
      const out: Record<string, unknown> = { id: entryId, entry_type: "workout", exercise_key: s.exercise_key, state_version: version };
      if (Array.isArray(s.data.sets)) out.total_sets = (s.data.sets as unknown[]).length;
      if (typeof s.data.duration_min === "number") out.duration_min = s.data.duration_min;
      logged.push(out);
    } else if (s.type === "meal") {
      logged.push({
        id: entryId,
        entry_type: "meal",
        meal_type: s.meal_type,
        totals: s.data.totals,
        state_version: version,
      });
    } else {
      logged.push({ id: entryId, entry_type: "weight", weight_kg: s.data.weight_kg, state_version: version });
    }
  }

  // Catalogue upsert rides in the same transact — a log is one write.
  if (catalogItems.length > 0) {
    chunks.push(...(await exerciseUpsertChunks(env, user, catalogItems)) as unknown as typeof chunks);
  }
  const result = { logged };
  chunks.push(receiptChunk(env, user, prepared, "nexus_log_entries", args.mutation_id, result));
  if (chunks.length > 0) await db.transact(chunks as never);
  return result;
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
  // For own reads we also need the exercise-key list, the catalogue, and the
  // pending-request count. They're independent of the entries query, so fire
  // them all together — sequential InstantDB calls are ~400ms each and stack
  // up otherwise.
  let exerciseKeys: string[] = [];
  let uncatalogued: string[] = [];
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
    const [entriesRes, exRes, catRes, pendingRes] = await Promise.all([
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
        exercises: { $: { fields: ["key", "muscle"], limit: 1000 } },
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
    // A key is uncatalogued until its catalogue row exists AND has a muscle —
    // this is what tells the model to send metadata next time it logs the key,
    // which is also how pre-catalogue history backfills itself over time.
    const cataloged = new Map<string, { muscle?: string | null }>(
      (catRes.exercises as { key: string; muscle?: string | null }[]).map((r) => [r.key, r]),
    );
    uncatalogued = [...keys].filter((k) => {
      const c = cataloged.get(k);
      return !c || c.muscle == null;
    }).sort();
    for (const k of cataloged.keys()) keys.add(k);
    exerciseKeys = [...keys].sort();
    pendingCount = pendingRes.friendships.length;
  }

  const workouts: Record<string, unknown>[] = [];
  const meals: Record<string, unknown>[] = [];
  const weights: Record<string, unknown>[] = [];

  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const base = {
      id: row.id,
      date: msToDate(row.entry_date),
      state_version: row.version ?? String(row.updated_at),
    };
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

  // Single-day own reads (the widget card, the post-log payload) carry each
  // workout's previous session and a PR flag — the Strong mechanic: every
  // exercise shows what you did last time, and says when you beat your best.
  if (!args.friend_id && fromDate === toDate && workouts.length > 0) {
    const dayKeys = [...new Set(workouts.map((w) => w.exercise_key).filter(Boolean))] as string[];
    if (dayKeys.length > 0) {
      const scoped = userDb(env, user.email);
      // Recent-first; 400 rows of prior history is plenty to find each key's
      // last session and a best weight worth calling a PR.
      const prior = await rawQuery(scoped, {
        entries: {
          $: {
            where: {
              type: "workout",
              exercise_key: { $in: dayKeys },
              entry_date: { $lt: dateToMs(fromDate) },
            },
            order: { entry_date: "desc" },
            limit: 400,
          },
        },
      });
      const topWeight = (sets: unknown): number | null => {
        let top: number | null = null;
        if (Array.isArray(sets)) {
          for (const s of sets as { weight_kg?: unknown }[]) {
            if (typeof s.weight_kg === "number" && (top == null || s.weight_kg > top)) top = s.weight_kg;
          }
        }
        return top;
      };
      type PrevRec = { date: string; sets: unknown[]; best: number };
      const prevByKey = new Map<string, PrevRec>();
      for (const row of prior.entries as EntryRow[]) {
        const k = row.exercise_key;
        if (!k) continue;
        const sets = ((row.data ?? {}) as { sets?: unknown[] }).sets;
        let rec = prevByKey.get(k);
        if (!rec) {
          // Rows are newest-first, so the first row per key IS the last session.
          rec = { date: msToDate(row.entry_date), sets: Array.isArray(sets) ? sets : [], best: 0 };
          prevByKey.set(k, rec);
        }
        const top = topWeight(sets);
        if (top != null && top > rec.best) rec.best = top;
      }
      for (const w of workouts) {
        const rec = prevByKey.get(w.exercise_key as string);
        if (!rec) continue;
        w.previous = {
          date: rec.date,
          sets: rec.sets,
          ...(rec.best > 0 ? { best_weight_kg: rec.best } : {}),
        };
        const top = topWeight((w as { sets?: unknown[] }).sets);
        if (top != null && rec.best > 0 && top > rec.best) w.pr = true;
      }
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
    if (uncatalogued.length > 0) result.uncatalogued_exercises = uncatalogued;
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
    // The goal in effect on THIS day, not whatever it is today — a friend's
    // goal for a friend read, gated by the friendship check already run above.
    result.goal = await getGoalForDate(env, args.friend_id ?? user.userId, toDate);
  }

  return result;
}

export async function updateEntry(
  env: NexusEnv,
  user: UserCtx,
  args: { mutation_id: string; entry_id: string; expected_state_version: string; data: EntryUpdateDataInput },
): Promise<Record<string, unknown>> {
  const prepared = await prepareMutation(env, user, "nexus_update_entry", args.mutation_id, args);
  if (prepared.replay) return prepared.replay;
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
  const currentVersion = row.version ?? String(row.updated_at);
  if (args.expected_state_version !== currentVersion) {
    throw new ValidationError(
      `Entry ${args.entry_id} changed after this snapshot (expected ${args.expected_state_version}, current ${currentVersion}). Read the latest history and retry the intended edit with a new mutation_id.`,
    );
  }
  const entryType = row.type as "workout" | "meal" | "weight";
  const nextVersion = await deterministicMutationId(prepared.receiptId, "entry-version");

  const reconstructed = { type: entryType, ...args.data };
  const entry = parseEntry(reconstructed);

  let patch: Record<string, unknown>;
  let storedData: Record<string, unknown>;
  if (entry.type === "workout") {
    const { type: _t, ...d } = entry;
    storedData = d;
    patch = { exercise_key: d.exercise_key.trim(), data: d, updated_at: Date.now(), version: nextVersion };
  } else if (entry.type === "meal") {
    const { type: _t, ...d } = entry;
    storedData = { ...d, totals: computeMealTotals(d.items) };
    patch = { meal_type: d.meal_type, data: storedData, updated_at: Date.now(), version: nextVersion };
  } else {
    const { type: _t, ...d } = entry;
    storedData = d;
    patch = { data: d, updated_at: Date.now(), version: nextVersion };
  }

  const db = adminDb(env);
  const result: Record<string, unknown> = {
    id: args.entry_id,
    entry_type: entryType,
    updated: true,
    state_version: nextVersion,
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
  await db.transact([
    db.tx.entries[args.entry_id]!.update(patch),
    receiptChunk(env, user, prepared, "nexus_update_entry", args.mutation_id, result),
  ]);
  return result;
}
