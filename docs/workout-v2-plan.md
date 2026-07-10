# Nexus workouts v2 — the 3 core things

The calorie half of Nexus copied MyFitnessPal's proven mechanics and it works. The workout half was a read-only 3-column table. This round steals the essentials from Strong/Hevy — nothing else.

## 1. Exercise catalogue — ChatGPT creates the exercise (DB + API) ✅ shipped

A workout's identity matters: dumbbell vs barbell vs 30° incline are different exercises, and history is only analyzable if they're catalogued as different things.

- New `exercises` entity in InstantDB: `key, name, muscle, pattern, equipment, is_bodyweight`, owner-linked. One row per exercise_key per user.
- No built-in 215-exercise seed list — ChatGPT is the seed list. When the model logs a key that's new (or listed in `uncatalogued_exercises` in history output), it passes `muscle/pattern/equipment/is_bodyweight` in the same `nexus_log_entries` call and the server upserts the row. Fill-gaps-only: a later log never overwrites a field that's already set.
- Existing history backfills itself: the server flags old keys as uncatalogued, the model supplies metadata next time each one is logged.
- Server instructions now force variant-specific keys ("bench_press_barbell", never "bench").

## 2. Previous session + PR in the payload (API) ✅ shipped

The Strong feature: every exercise shows what you did last time.

- Single-day history/log payloads now attach to each workout: `previous: { date, sets, best_weight_kg }` (last session for that key) and `pr: true` when today's top weight beats the all-time best.
- The model is instructed to congratulate on `pr: true`; the widget renders it.

## 3. Set-level editor in the widget ✅ shipped

The meal-editor pattern, extended to workouts (WIDGET_URI bumped to v5):

- Tap an exercise row → editor box below, same two-box layout as food.
- Ghost line: "Last time · Wed 8 Jul: 60×8 60×7 57.5×8 · best 60kg".
- Set rows: `#  [− 60 +] kg  [− 8 +] reps  ×` — weight steps ±2.5, reps ±1, typed input still works.
- **+ Add set** copies the last set (or seeds from last session's first set).
- PR chip on any set beating the historical best, and next to the exercise in the list.
- Save = full-replacement write through the live InstantDB session (falls back to `nexus_update_entry`). Draft state survives live re-renders; ghost data survives live subscription updates via a client-side previous-by-key map.
- Phone width drops the kg/reps unit labels so the PR chip and per-set delete keep their seats.

---

## Parked (talk later)

The Laksh features (log.lakshg.com): plan-as-block with per-week prescriptions, rules/goals lists, day templates with a Start button that prefills the log. Design sketch lives in git history of this file. Revisit once the core loop above is proven in daily use.

Also parked: set tags (warmup/failure), RPE, sessions entity, rest timer (fake inside a chat iframe), plate calculator (ChatGPT can answer that).
