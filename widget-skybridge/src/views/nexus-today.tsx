import { Dumbbell, Flame, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useLayout, useViewState } from "skybridge/web";
import { DISCOBOLUS_DATA_URI, VENUS_DATA_URI } from "../gods.js";
import { useCallTool, useToolInfo } from "../helpers.js";

import "@/index.css";

// Venus (left) + Discobolus (right) marble busts flank the card as a faint,
// theme-adaptive watermark. Fed to the ::before/::after pseudo-elements as CSS
// vars so the big base64 URIs live in one place.
const godVars = {
  "--nx-venus-img": `url("${VENUS_DATA_URI}")`,
  "--nx-disco-img": `url("${DISCOBOLUS_DATA_URI}")`,
} as CSSProperties;

// ---- Shapes (mirror the server's structuredContent) ---------------------
type Totals = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
type Item = { name: string; quantity?: number } & Partial<Totals>;
type Meal = { id: string; meal_type?: string; items?: Item[]; totals?: Totals };
type SetRow = { weight_kg?: number; reps?: number };
type Workout = { id: string; exercise?: string; exercise_key?: string; sets?: SetRow[]; duration_min?: number };
type Weight = { weight_kg?: number };
type Goal = { calories?: number; protein_g?: number };
type Day = {
  period?: { from: string; to: string };
  goal?: Goal;
  meals?: Meal[];
  workouts?: Workout[];
  weights?: Weight[];
};

const DEFAULT_GOAL_KCAL = 2100;
const DEFAULT_GOAL_PROTEIN = 120;

// ---- Small helpers ------------------------------------------------------
const n = (x: unknown) => (typeof x === "number" ? Math.round(x * 10) / 10 : 0);
const num = (v: string) => {
  const x = parseFloat(v);
  return isFinite(x) && x >= 0 ? x : 0;
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function fmtDate(d?: string) {
  if (!d) return "";
  try {
    return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return d;
  }
}

function mealName(m: Meal) {
  if (m.meal_type && (!m.items || !m.items.length)) return m.meal_type;
  const names = (m.items || []).map((i) => i.name).filter(Boolean).join(", ");
  return (m.meal_type ? `${m.meal_type}: ` : "") + names;
}

function foodTotals(meals: Meal[]): Totals {
  return meals.reduce<Totals>(
    (t, m) => {
      const mt = m.totals || ({} as Totals);
      return {
        calories: t.calories + (mt.calories || 0),
        protein_g: t.protein_g + (mt.protein_g || 0),
        carbs_g: t.carbs_g + (mt.carbs_g || 0),
        fat_g: t.fat_g + (mt.fat_g || 0),
      };
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

// ---- Presentational bits ------------------------------------------------
function Ring({ pct, big, small }: { pct: number; big: string; small: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp01(pct));
  return (
    <svg className="nx-ring" width="118" height="118" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="trk" cx="50" cy="50" r={r} fill="none" strokeWidth="9" />
      <circle
        className="val"
        cx="50"
        cy="50"
        r={r}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c.toFixed(1)}
        strokeDashoffset={off.toFixed(1)}
        transform="rotate(-90 50 50)"
      />
      <text className="big" x="50" y="49" textAnchor="middle">
        {big}
      </text>
      <text className="sm" x="50" y="62" textAnchor="middle">
        {small}
      </text>
    </svg>
  );
}

function ProgRow({
  label,
  value,
  pct,
  showBar,
}: {
  label: string;
  value: React.ReactNode;
  pct?: number;
  showBar?: boolean;
}) {
  return (
    <div className="nx-m2">
      <div className="nx-m2-top">
        <span className="lbl">{label}</span>
        <span className="val">{value}</span>
      </div>
      {showBar ? (
        <div className="nx-bar">
          <i style={{ width: `${Math.round(clamp01(pct || 0) * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

// ---- Editor (Change 2: X-close) -----------------------------------------
function Editor({
  meal,
  onSave,
  onClose,
  saving,
  error,
}: {
  meal: Meal;
  onSave: (v: { name: string; totals: Totals }) => void;
  onClose: () => void;
  saving: boolean;
  error: string;
}) {
  const t = meal.totals || ({} as Totals);
  const firstName = (meal.items && meal.items[0]?.name) || meal.meal_type || "";
  const [name, setName] = useState(firstName);
  const [kcal, setKcal] = useState(String(n(t.calories)));
  const [p, setP] = useState(String(n(t.protein_g)));
  const [c, setC] = useState(String(n(t.carbs_g)));
  const [f, setF] = useState(String(n(t.fat_g)));

  return (
    <div className="nx-box editor">
      <button type="button" className="nx-editor-x" aria-label="Close editor" title="Close" onClick={onClose}>
        <X size={16} />
      </button>
      <input
        className="nx-name"
        value={name}
        placeholder="What was it?"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="nx-macros">
        {(
          [
            ["kcal", kcal, setKcal],
            ["protein", p, setP],
            ["carbs", c, setC],
            ["fat", f, setF],
          ] as const
        ).map(([label, val, set]) => (
          <label className="nx-macro" key={label}>
            <span>{label}</span>
            <input type="number" inputMode="decimal" min="0" step="1" value={val} onChange={(e) => set(e.target.value)} />
          </label>
        ))}
      </div>
      {error ? <div className="nx-err">{error}</div> : null}
      <div className="nx-btns">
        <button
          type="button"
          className="nx-save"
          disabled={saving}
          onClick={() =>
            onSave({
              name: name.trim() || "Meal",
              totals: {
                calories: Math.round(num(kcal)),
                protein_g: Math.round(num(p) * 10) / 10,
                carbs_g: Math.round(num(c) * 10) / 10,
                fat_g: Math.round(num(f) * 10) / 10,
              },
            })
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---- Main view ----------------------------------------------------------
function NexusToday() {
  const { output } = useToolInfo<"nexus_view_today">();
  const day = (output || {}) as Day;

  // Honor the host's theme (ChatGPT / Claude / DevTools toggle) instead of only
  // the OS prefers-color-scheme — data-theme wins in the CSS below.
  const { theme } = useLayout();

  // Persisted UI state — survives remounts (fullscreen<->inline) and reopen.
  const [ui, setUi] = useViewState<{
    view: "food" | "workout";
    selectedId: string | null;
    editorOpen: boolean;
  }>({ view: "food", selectedId: null, editorOpen: true });

  // Optimistic edits applied on top of the server snapshot.
  const [edits, setEdits] = useState<Record<string, { name: string; totals: Totals }>>({});
  const [saveError, setSaveError] = useState("");
  const { callTool: updateEntry, isPending: saving } = useCallTool("nexus_update_entry");

  const goalKcal = day.goal?.calories ?? DEFAULT_GOAL_KCAL;
  const goalProtein = day.goal?.protein_g ?? DEFAULT_GOAL_PROTEIN;

  const meals: Meal[] = useMemo(() => {
    const base = day.meals || [];
    return base.map((m) => {
      const e = edits[m.id];
      if (!e) return m;
      return { ...m, items: [{ ...(m.items?.[0] || {}), name: e.name, ...e.totals }], totals: e.totals };
    });
  }, [day.meals, edits]);

  const workouts = day.workouts || [];
  const weights = day.weights || [];
  const both = meals.length > 0 && workouts.length > 0;
  const view = ui.view === "workout" && !workouts.length ? "food" : ui.view;

  const title = useMemo(() => {
    const p = day.period;
    if (!p) return "";
    return p.from === p.to ? fmtDate(p.from) : `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
  }, [day.period]);

  const t = foodTotals(meals);
  const selectedId = meals.find((m) => m.id === ui.selectedId) ? ui.selectedId : meals[0]?.id ?? null;
  const selMeal = meals.find((m) => m.id === selectedId) || null;

  function selectMeal(id: string) {
    setSaveError("");
    setUi((s) => ({ ...s, selectedId: id, editorOpen: true }));
  }
  function closeEditor() {
    setUi((s) => ({ ...s, editorOpen: false }));
  }
  async function save(v: { name: string; totals: Totals }) {
    if (!selMeal) return;
    setSaveError("");
    setEdits((e) => ({ ...e, [selMeal.id]: v }));
    try {
      await updateEntry({
        entry_id: selMeal.id,
        data: {
          items: [{ name: v.name, quantity: selMeal.items?.[0]?.quantity ?? 1, ...v.totals }],
          totals: v.totals,
          ...(selMeal.meal_type ? { meal_type: selMeal.meal_type } : {}),
        },
      });
    } catch (err) {
      setSaveError((err as Error)?.message || "Couldn't save. Try again.");
    }
  }

  return (
    <div
      className="nx-root"
      data-theme={theme === "dark" ? "dark" : theme === "light" ? "light" : undefined}
      style={godVars}
    >
      <div className="nx-top">
        <span className="nx-date">{title}</span>
        {both ? (
          <span className="nx-seg" role="tablist" aria-label="Food or workout">
            <button
              type="button"
              className={view === "food" ? "on" : ""}
              aria-label="Food"
              aria-selected={view === "food"}
              title="Food"
              onClick={() => setUi((s) => ({ ...s, view: "food" }))}
            >
              <Flame size={16} />
            </button>
            <button
              type="button"
              className={view === "workout" ? "on" : ""}
              aria-label="Workout"
              aria-selected={view === "workout"}
              title="Workout"
              onClick={() => setUi((s) => ({ ...s, view: "workout" }))}
            >
              <Dumbbell size={16} />
            </button>
          </span>
        ) : null}
      </div>

      {view === "workout" ? (
        <WorkoutView workouts={workouts} weights={weights} />
      ) : (
        <>
          {/* Wide (laptop): calorie ring + protein bar + carbs/fat readout. */}
          <div className="nx-prog-wide">
            <Ring pct={t.calories / goalKcal} big={String(n(t.calories))} small={`of ${goalKcal}`} />
            <div className="nx-macros2">
              <ProgRow
                label="Protein"
                value={
                  <>
                    <b>{n(t.protein_g)}</b> / {goalProtein}g
                  </>
                }
                pct={t.protein_g / goalProtein}
                showBar
              />
              <ProgRow label="Carbs" value={<><b>{n(t.carbs_g)}</b> g</>} />
              <ProgRow label="Fat" value={<><b>{n(t.fat_g)}</b> g</>} />
            </div>
          </div>

          {/* Phone (narrow): calories + protein as twin rings, no carbs/fat —
              nobody reads those off a two-inch card. CSS swaps which block shows
              by the host's own viewport width, no JS. */}
          <div className="nx-prog-narrow">
            <div className="nx-rings-row">
              <div>
                <Ring pct={t.calories / goalKcal} big={String(n(t.calories))} small={`of ${goalKcal}`} />
                <div className="nx-ring-cap">Calories</div>
              </div>
              <div>
                <Ring pct={t.protein_g / goalProtein} big={`${n(t.protein_g)}g`} small={`of ${goalProtein}g`} />
                <div className="nx-ring-cap">Protein</div>
              </div>
            </div>
          </div>

          {meals.length ? (
            <>
              <div className="nx-box list">
                <table className="nx-tbl">
                  <thead>
                    <tr>
                      <th className="l" />
                      <th>kcal</th>
                      <th>protein</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meals.map((m) => {
                      const mt = m.totals || ({} as Totals);
                      const sel = m.id === selectedId && ui.editorOpen;
                      return (
                        <tr key={m.id} className={`nx-tap${sel ? " nx-sel" : ""}`} onClick={() => selectMeal(m.id)}>
                          <td className="nm">{mealName(m)}</td>
                          <td className="num">{n(mt.calories)}</td>
                          <td className="num">{n(mt.protein_g)}g</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {ui.editorOpen && selMeal ? (
                <Editor
                  key={selMeal.id}
                  meal={selMeal}
                  onSave={save}
                  onClose={closeEditor}
                  saving={saving}
                  error={saveError}
                />
              ) : null}
            </>
          ) : (
            <div className="nx-box list">
              <div className="nx-empty">Nothing logged yet. Tell ChatGPT what you ate.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WorkoutView({ workouts, weights }: { workouts: Workout[]; weights: Weight[] }) {
  const totalSets = workouts.reduce((s, w) => s + (w.sets?.length || 0), 0);
  return (
    <>
      <div className="nx-prog-wide">
        <div className="nx-macros2">
          <ProgRow label="Exercises" value={<b>{workouts.length}</b>} />
          <ProgRow label="Sets" value={<b>{totalSets}</b>} />
          {weights.length ? <ProgRow label="Weight" value={<><b>{n(weights[0].weight_kg)}</b> kg</>} /> : null}
        </div>
      </div>
      <div className="nx-box list">
        <table className="nx-tbl">
          <thead>
            <tr>
              <th className="l" />
              <th>Sets</th>
              <th>Top</th>
            </tr>
          </thead>
          <tbody>
            {workouts.map((w) => {
              const sets = w.sets || [];
              let top: number | null = null;
              for (const s of sets) if (s.weight_kg != null && (top == null || s.weight_kg > top)) top = s.weight_kg;
              return (
                <tr key={w.id}>
                  <td className="nm">{w.exercise || w.exercise_key}</td>
                  <td className="num">{sets.length || (w.duration_min ? `${w.duration_min}m` : "-")}</td>
                  <td className="num">{top != null ? `${top}kg` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default NexusToday;
