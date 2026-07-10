// The per-user exercise catalogue. One row per exercise_key, created the
// first time a key is logged and enriched over time: the model passes
// muscle/pattern/equipment when it logs a key the server flags as
// uncatalogued, and the upsert fills gaps without ever overwriting a field
// that's already set (the user may have corrected it).
import type { NexusEnv } from "../types";
import { adminDb, rawQuery, id as newId } from "../instant";
import type { ExerciseCatalogInput } from "../schema/entry-shapes";
import type { UserCtx } from "./entries";

export type ExerciseRow = {
  id: string;
  key: string;
  name: string;
  muscle?: string;
  pattern?: string;
  equipment?: string;
  is_bodyweight?: boolean;
};

/** Build the transaction chunks that bring the catalogue up to date with the
 *  exercises in a log call. Runs one query; the caller folds the chunks into
 *  its own transact so a log stays a single write. */
export async function exerciseUpsertChunks(
  env: NexusEnv,
  user: UserCtx,
  items: ExerciseCatalogInput[],
): Promise<unknown[]> {
  if (items.length === 0) return [];

  // Last mention of a key in the same call wins for each provided field.
  const byKey = new Map<string, ExerciseCatalogInput>();
  for (const it of items) {
    const prev = byKey.get(it.key);
    byKey.set(it.key, prev ? { ...prev, ...definedFields(it) } as ExerciseCatalogInput : it);
  }

  const db = adminDb(env);
  const existing = await rawQuery(db, {
    exercises: {
      $: { where: { "owner.id": user.userId, key: { $in: [...byKey.keys()] } } },
    },
  });
  const rows = new Map<string, ExerciseRow>(
    (existing.exercises as ExerciseRow[]).map((r) => [r.key, r]),
  );

  const now = Date.now();
  const chunks: unknown[] = [];
  for (const [key, it] of byKey) {
    const row = rows.get(key);
    if (!row) {
      chunks.push(
        db.tx.exercises[newId()]!
          .update({
            key,
            name: it.name,
            muscle: it.muscle,
            pattern: it.pattern,
            equipment: it.equipment,
            is_bodyweight: it.is_bodyweight,
            created_at: now,
          })
          .link({ owner: user.userId }),
      );
      continue;
    }
    // Fill gaps only — never clobber a field that already has a value.
    const patch: Record<string, unknown> = {};
    if (row.muscle == null && it.muscle != null) patch.muscle = it.muscle;
    if (row.pattern == null && it.pattern != null) patch.pattern = it.pattern;
    if (row.equipment == null && it.equipment != null) patch.equipment = it.equipment;
    if (row.is_bodyweight == null && it.is_bodyweight != null) patch.is_bodyweight = it.is_bodyweight;
    if (Object.keys(patch).length > 0) {
      patch.updated_at = now;
      chunks.push(db.tx.exercises[row.id]!.update(patch));
    }
  }
  return chunks;
}

function definedFields(it: ExerciseCatalogInput): Partial<ExerciseCatalogInput> {
  const out: Partial<ExerciseCatalogInput> = { key: it.key, name: it.name };
  if (it.muscle != null) out.muscle = it.muscle;
  if (it.pattern != null) out.pattern = it.pattern;
  if (it.equipment != null) out.equipment = it.equipment;
  if (it.is_bodyweight != null) out.is_bodyweight = it.is_bodyweight;
  return out;
}
