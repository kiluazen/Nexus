# NEXUS v2 Design: Workout + Calorie Logging

## Constraints

- Tools are explicitly called by ChatGPT. They don't passively capture anything.
- The server is a database. ChatGPT does the thinking, suggesting, coaching.
- No auto-suggest from server. ChatGPT already does that.
- Exercise and nutrition = valid user input. Sleep and mood = not.
- Partial data = bad. Stay in one domain and do it well.

---

## Schema

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,                  -- Supabase sub claim
    display_name TEXT NOT NULL,           -- From Google profile
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE entries (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    entry_type TEXT NOT NULL,             -- "workout" or "meal"
    date DATE NOT NULL,                   -- The day this is for (YYYY-MM-DD)
    exercise_key TEXT,                    -- "bench_press" for workouts, NULL for meals
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_entries_user_date ON entries(user_id, date DESC);
CREATE INDEX idx_entries_user_exercise ON entries(user_id, exercise_key);
CREATE INDEX idx_entries_type ON entries(user_id, entry_type);
```

### Why this shape

**One `entries` table, not separate workout/meal tables.** Simpler queries, simpler
code. `entry_type` + `exercise_key` + `data` JSONB covers both.

**`exercise_key` as a real column, not inside JSONB.** We need it for:
- Fast index on `(user_id, exercise_key)` for progression queries
- Cheap `SELECT DISTINCT exercise_key` for the known exercises list

**`exercise_key` is NULL for meals.** Multiple meals per day is normal.

**`updated_at` column.** Entries can be updated (correcting reps, adding sets,
fixing meal items).

---

## Data Shapes (what lives in the `data` JSONB column)

### Workout — Strength

```json
{
  "exercise": "Bench Press",
  "exercise_key": "bench_press",
  "sets": [
    {"weight_kg": 60, "reps": 8},
    {"weight_kg": 60, "reps": 7},
    {"weight_kg": 55, "reps": 6}
  ],
  "notes": "shoulder felt tight on last set"
}
```

### Workout — Cardio

```json
{
  "exercise": "Treadmill",
  "exercise_key": "treadmill",
  "duration_min": 10,
  "distance_km": 1.5,
  "notes": "easy pace"
}
```

### Workout — Allowed JSONB keys

Strength: `exercise`, `exercise_key`, `sets` (array of {weight_kg, reps}), `notes`
Cardio: `exercise`, `exercise_key`, `duration_min`, `distance_km`, `notes`

Server validates: reject unknown keys. `exercise` and `exercise_key` are required
for all workouts.

### Meal — Input (what ChatGPT sends)

```json
{
  "meal_type": "lunch",
  "items": [
    {"name": "chapati", "quantity": 2, "calories": 220,
     "protein_g": 6, "carbs_g": 40, "fat_g": 4},
    {"name": "egg bhurji", "quantity": 1, "calories": 235,
     "protein_g": 18, "carbs_g": 3, "fat_g": 17},
    {"name": "chicken leg curry", "quantity": 1, "calories": 150,
     "protein_g": 16, "carbs_g": 2, "fat_g": 6},
    {"name": "salad", "quantity": 1, "calories": 20,
     "protein_g": 1, "carbs_g": 3, "fat_g": 0}
  ],
  "notes": "Lunch from photo"
}
```

Every item MUST have: `name`, `quantity`, `calories`, `protein_g`, `carbs_g`, `fat_g`.
No item skips any macro field.

### Meal — Stored (server computes totals, saves the full object)

```json
{
  "meal_type": "lunch",
  "items": [
    {"name": "chapati", "quantity": 2, "calories": 220,
     "protein_g": 6, "carbs_g": 40, "fat_g": 4},
    {"name": "egg bhurji", "quantity": 1, "calories": 235,
     "protein_g": 18, "carbs_g": 3, "fat_g": 17},
    {"name": "chicken leg curry", "quantity": 1, "calories": 150,
     "protein_g": 16, "carbs_g": 2, "fat_g": 6},
    {"name": "salad", "quantity": 1, "calories": 20,
     "protein_g": 1, "carbs_g": 3, "fat_g": 0}
  ],
  "totals": {
    "calories": 625,
    "protein_g": 41,
    "carbs_g": 48,
    "fat_g": 27
  },
  "notes": "Lunch from photo"
}
```

Totals are computed server-side from items. The server is the source of truth for
the math, not ChatGPT.

### Meal — Allowed JSONB keys

Top level: `meal_type`, `items` (required), `totals` (server-computed), `notes`
Per item: `name`, `quantity`, `calories`, `protein_g`, `carbs_g`, `fat_g`

Server validates: reject unknown keys. `items` array is required and must be
non-empty. Each item must have all 6 fields.

---

## Tools

### Tool 1: `log`

Pure insert. Always creates new rows. Never updates.

```python
@mcp.tool
def log(
    entries: list[dict],
    date: str | None = None,
) -> dict:
    """Store workout and/or meal entries for the authenticated user.

    Before calling this, call history() for the target date first. If an
    exercise already exists that day, use update() instead — don't duplicate.

    Workout shape:
      {"type": "workout", "exercise": "Dumbbell Bench Press",
       "exercise_key": "dumbbell_bench_press",
       "sets": [{"weight_kg": 25, "reps": 8}]}
    Other Workouts:
      {"type": "workout", "exercise": "Jiu Jitsu",
       "exercise_key": "jiu_jitsu", "duration_min": 60, "notes":'Trained how to go from half control to side control or mount'}
    Meal shape:
      {"type": "meal", "meal_type": "lunch",
       "items": [{"name": "chapati", "quantity": 2, "calories": 220,
                  "protein_g": 6, "carbs_g": 40, "fat_g": 4}, ...]}

    exercise_key: lowercase_with_underscores, shortest unambiguous name.
    MUST reuse keys from your_exercises in history(). For new exercises,
    confirm the name and key, by searching the web or asking the human

    Meals: estimate macros PER ITEM, not for the whole meal. Every item
    must have name, quantity, calories, protein_g, carbs_g, fat_g. The
    server computes totals. You need to think deeply about that here ask clarifying questions cause this must be as accurate as possible

    Args:
        entries: List of entries to log.
        date: YYYY-MM-DD, defaults to today. 
    """
```

#### Server behavior

- Validate JSONB keys, INSERT new row. Extract `exercise_key`
  into the column. Set `date` from the `date` param (defaults to today).
- **Meal entries:** Validate each item has all 6 required fields. Compute totals
  server-side by summing across items. Store items + totals. INSERT new row.

#### Response shape

```json
{
  "logged": [
    {
      "id": 12,
      "entry_type": "workout",
      "exercise_key": "bench_press",
      "total_sets": 3
    },
    {
      "id": 13,
      "entry_type": "meal",
      "meal_type": "lunch",
      "totals": {
        "calories": 625,
        "protein_g": 41,
        "carbs_g": 48,
        "fat_g": 27
      },
      "items_count": 4
    }
  ]
}
```

Returns the row ID for each created entry so ChatGPT can reference it in
subsequent update() calls.

---

### Tool 2: `history`

```python
@mcp.tool
def history(
    date: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    type: str | None = None,
) -> dict:
    """Fetch entries for the authenticated user. Call before log() to
    avoid duplicates. Response includes your_exercises: all exercise_keys
    ever used — reuse these when logging.

    With no arguments: returns the last 7 days.

    Args:
        date: Single date YYYY-MM-DD (shortcut for from_date=to_date).
        from_date: Range start (inclusive).
        to_date: Range end (inclusive).
        type: "workout" or "meal". Omit for both.
    """
```

#### Response shape

```json
{
  "user": "Kushal",
  "period": {"from": "2026-03-20", "to": "2026-03-20"},
  "workouts": [
    {
      "id": 12,
      "exercise": "Bench Press",
      "exercise_key": "bench_press",
      "sets": [
        {"weight_kg": 60, "reps": 8},
        {"weight_kg": 60, "reps": 7},
        {"weight_kg": 55, "reps": 6}
      ]
    },
    {
      "id": 13,
      "exercise": "Treadmill",
      "exercise_key": "treadmill",
      "duration_min": 10,
      "distance_km": 1.5
    }
  ],
  "meals": [
    {
      "id": 14,
      "meal_type": "lunch",
      "items": [
        {"name": "chapati", "quantity": 2, "calories": 220,
         "protein_g": 6, "carbs_g": 40, "fat_g": 4},
        {"name": "egg bhurji", "quantity": 1, "calories": 235,
         "protein_g": 18, "carbs_g": 3, "fat_g": 17},
        {"name": "chicken leg curry", "quantity": 1, "calories": 150,
         "protein_g": 6, "carbs_g": 2, "fat_g": 2},
        {"name": "salad", "quantity": 1, "calories": 20,
         "protein_g": 1, "carbs_g": 3, "fat_g": 0}
      ],
      "totals": {"calories": 625, "protein_g": 41, "carbs_g": 48, "fat_g": 27}
    }
  ],
  "day_totals": {
    "exercises": 2,
    "total_sets": 3,
    "calories": 625,
    "protein_g": 41,
    "carbs_g": 48,
    "fat_g": 27,
    "meals_logged": 1
  },
  "your_exercises": [
    "bench_press",
    "dumbbell_bench_press",
    "squat",
    "treadmill",
    "leg_press"
  ]
}
```

`your_exercises`: `SELECT DISTINCT exercise_key FROM entries WHERE user_id = $1
AND exercise_key IS NOT NULL`. Returned on every history call so ChatGPT always
has the canonical exercise key list.

`day_totals`: computed server-side. Nutrition totals summed from all meals that
day. Workout counts from workout entries. Only included when querying a single day.

---

### Tool 3: `update`

```python
@mcp.tool
def update(
    entry_id: int,
    data: dict,
) -> dict:
    """Replace the data of an existing entry. Send the COMPLETE data
    object — not a partial patch. For meals the server recomputes totals.

    Args:
        entry_id: Row ID from history().
        data: Full replacement data (same shape as log entries).
    """
```

#### Server behavior

```sql
UPDATE entries
SET data = $1, updated_at = now()
WHERE id = $2 AND user_id = $3
RETURNING id, entry_type, data;
```

- Validates that the entry belongs to the authenticated user.
- Validates JSONB keys same as log().
- For meals: recomputes totals from items before storing.
- Full replace, not merge. ChatGPT sends the complete updated state.

#### Response shape

```json
{
  "id": 12,
  "entry_type": "workout",
  "updated": true,
  "exercise_key": "bench_press",
  "total_sets": 3
}
```

For meals:
```json
{
  "id": 14,
  "entry_type": "meal",
  "updated": true,
  "totals": {
    "calories": 625,
    "protein_g": 41,
    "carbs_g": 48,
    "fat_g": 27
  },
  "items_count": 4
}
```

---

## Walkthrough: Set-by-Set Logging With Corrections

1. User: "Starting bench press, just did 60kg for 8"

   ChatGPT calls `history(date="2026-03-20")`.
   Response: no bench entry today. `your_exercises` includes "bench_press".

   ChatGPT calls `log(entries=[{"type": "workout", "exercise": "Bench Press",
   "exercise_key": "bench_press", "sets": [{"weight_kg": 60, "reps": 8}]}])`.
   Server: INSERT. Returns `id: 12, total_sets: 1`.

   ChatGPT: "Logged bench press — set 1: 60kg × 8."

2. User: "Second set done, 60kg but only got 7"

   ChatGPT knows entry 12 currently has `[{60, 8}]`.
   ChatGPT calls `update(entry_id=12, data={...exercise fields...,
   "sets": [{"weight_kg": 60, "reps": 8}, {"weight_kg": 60, "reps": 7}]})`.
   Server: full replace. Returns `total_sets: 2`.

   ChatGPT: "Set 2: 60kg × 7. Two down."

3. User: "Wait, first set was actually 9 reps not 8"

   ChatGPT calls `update(entry_id=12, data={...exercise fields...,
   "sets": [{"weight_kg": 60, "reps": 9}, {"weight_kg": 60, "reps": 7}]})`.
   Server: full replace. Returns `total_sets: 2`.

   ChatGPT: "Fixed — set 1 updated to 60kg × 9."

4. User: "Last set, dropped to 55, got 6"

   ChatGPT calls `update(entry_id=12, data={...exercise fields...,
   "sets": [{"weight_kg": 60, "reps": 9}, {"weight_kg": 60, "reps": 7},
            {"weight_kg": 55, "reps": 6}]})`.
   Server: full replace. Returns `total_sets: 3`.

   ChatGPT: "Done! Bench press: 3 sets (60×9, 60×7, 55×6). Solid."

---

## Walkthrough: Meal Photo Logging

1. User sends a photo of their lunch plate.

2. ChatGPT uses vision to identify items. Estimates per-item macros:

   "I see: 2 chapatis, egg bhurji (~2-3 eggs), chicken leg curry, small salad.
   My estimates:
   - Chapati ×2: 220 cal, 6g protein, 40g carbs, 4g fat
   - Egg bhurji: 235 cal, 18g protein, 3g carbs, 17g fat
   - Chicken leg curry: 150 cal, 16g protein, 2g carbs, 6g fat
   - Salad: 20 cal, 1g protein, 3g carbs, 0g fat

   Should I log this?"

3. User: "Yeah looks right"

4. ChatGPT calls `log(entries=[{"type": "meal", "meal_type": "lunch",
   "items": [...all 4 items with full macros...]}])`.

5. Server computes totals (625 cal, 41g protein, 48g carbs, 27g fat), stores
   items + totals, returns computed totals and row ID.

6. ChatGPT: "Logged lunch — 625 cal, 41g protein. You're at 1025 cal and
   71g protein so far today."

7. User: "Actually I had 3 chapatis not 2"

8. ChatGPT calls `update(entry_id=14, data={...same meal but chapati quantity
   changed to 3, calories to 330, protein_g to 9, carbs_g to 60, fat_g to 6...})`.

9. Server recomputes totals from updated items. Returns new totals.

10. ChatGPT: "Fixed — 3 chapatis. Lunch is now 735 cal, 44g protein."

---

## Migration From Current State

Current: 2 tables (workout_entries with raw_json, generic_events with raw_json)
New: 2 tables (users, entries)

Steps:
1. Create new tables alongside old ones.
2. Backfill: migrate existing workout_entries → entries (entry_type="workout").
   Extract exercise name and date from raw_json, generate exercise_key.
3. Deploy new tools (log, history, update) replacing old ones.
4. Drop old tables once confirmed.

OAuth layer doesn't change. MCP endpoint doesn't change.

---

## Open Questions

1. **Phone sessions**: If a user starts a chat on web (where MCP is connected)
   and continues on phone, does the MCP connection persist for that thread?
   Needs testing.

2. **Delete**: No delete mechanism yet. User says "remove that meal entirely."
   Could add a `delete` tool or a soft-delete flag. Defer to v2.1?

3. **Calorie/protein targets**: Should the server store daily targets so
   day_totals can include "remaining"? Defer to v2.1.
