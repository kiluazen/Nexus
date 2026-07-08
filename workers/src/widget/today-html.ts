// The Nexus day card — rendered natively inside ChatGPT.
//
// Calorie-first, goal-aware: a progress ring shows the day's kcal against a
// daily target, protein against its own target, carbs/fat read out beside it.
// Below, two separately-encased boxes make the structure self-evident without
// labels: the meal list (tap a row) and one constant editor that reflects
// whatever's selected. Workouts get their own view, auto-selected on workout
// logs. Accent is the landing cobalt; card background is transparent so it
// matches ChatGPT's own light/dark surface.
//
// Venus (left) + Discobolus (right) flank the card as a faint, theme-adaptive
// watermark, each faded toward the center with a CSS mask so they leave a clear
// gap and never sit behind the meal text.
//
// ChatGPT caches a widget resource by its ui:// URI (it snapshots the HTML).
// BUMP this suffix on breaking widget changes so clients fetch fresh.
import { VENUS_DATA_URI, DISCOBOLUS_DATA_URI } from "./gods";

export const WIDGET_URI = "ui://widget/nexus-today-v2.html";

// Fallback only — a user who's never called nexus_set_goal has no goal row
// yet, and the server's own DEFAULT_GOAL (schema/goal-shapes.ts) matches
// these exact numbers. Once data.goal arrives in the payload it always wins.
const DEFAULT_GOAL_KCAL = 2100;
const DEFAULT_GOAL_PROTEIN = 120;

// Inline lucide icons (stroke = currentColor) so the Food/Workout toggle reads
// as a flame (calories) + dumbbell, and the editor gets a corner close. Same
// icon set as the Skybridge trial so both look identical.
const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const FLAME_SVG =
  '<svg ' + ICON_ATTRS + '><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';
const DUMBBELL_SVG =
  '<svg ' + ICON_ATTRS + '><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/></svg>';
const X_SVG = '<svg ' + ICON_ATTRS + '><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

export function widgetHtml(): string {
  return `<div id="nexus-root"></div>
<style>
  :root {
    --nx-ink: #16181d; --nx-num: #16181d; --nx-mut: #6b7280; --nx-faint: #9aa0aa;
    --nx-accent: #1d2bb8; --nx-onacc: #ffffff;
    --nx-line: rgba(0,0,0,.09); --nx-hover: rgba(29,43,184,.05); --nx-selbg: rgba(29,43,184,.10);
    --nx-track: rgba(0,0,0,.09); --nx-fieldline: rgba(0,0,0,.16);
    --nx-boxbg: rgba(0,0,0,.028); --nx-seg: rgba(0,0,0,.05); --nx-segon: rgba(0,0,0,.10);
    --nx-chipbg: rgba(255,255,255,.92);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --nx-ink: #f2f3f5; --nx-num: #e9eaec; --nx-mut: #9096a0; --nx-faint: #6a6f78;
      --nx-accent: #8ea0ff; --nx-onacc: #0a1030;
      --nx-line: rgba(255,255,255,.08); --nx-hover: rgba(142,160,255,.09); --nx-selbg: rgba(142,160,255,.18);
      --nx-track: rgba(255,255,255,.12); --nx-fieldline: rgba(255,255,255,.16);
      /* boxbg is a dark scrim here (not a white tint like the light-mode
         value) — the statues now show in full behind these boxes with a
         brightening "screen" blend, so the box needs to dim what's behind
         it, not lighten it, or the CARBS/FAT labels wash out. */
      --nx-boxbg: rgba(0,0,0,.58); --nx-seg: rgba(255,255,255,.06); --nx-segon: rgba(255,255,255,.13);
      --nx-chipbg: rgba(32,34,40,.94);
    }
  }
  * { box-sizing: border-box; }
  #nexus-root {
    position: relative; overflow: hidden;
    --nx-god-op: .34; --nx-god-blend: multiply;
    /* Both crops are now a genuinely comparable "upper body" region (head to
       just above the hip line for Venus; head + torso + full extended arm,
       no legs, for Discobolus) — see gods.ts. They're still different
       shapes though: Venus's crop is 237x340 (AR .697), Discobolus's is
       427x340 (AR 1.256) because his extended arm widens the frame even
       with the legs gone. These two widths are tuned from those exact
       ratios (disco-w x .697/1.256 = venus-w) so their rendered HEIGHTS —
       the dimension that actually reads as "figure size" in a vertical
       card — come out equal instead of Venus dwarfing him or vice versa. */
    --nx-venus-w: 24%; --nx-disco-w: 44%;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--nx-ink); background: transparent; padding: 20px 22px;
  }
  /* Upper-body busts flank the card — ::before = Venus (left), ::after =
     Discobolus (right). background-size: contain so the whole trimmed
     figure always fits inside its box — no clipped arm, no clipped head, at
     any card or screen size. Blended against the card surface (multiply on
     light: shadows read as ink against paper; screen on dark: highlights
     glow off the dark surface) so they read as carved marble instead of a
     flat gray watermark. */
  #nexus-root::before, #nexus-root::after {
    content: ""; position: absolute; bottom: 0; height: 92%;
    z-index: 0; pointer-events: none; background-repeat: no-repeat;
    background-size: contain; opacity: var(--nx-god-op); mix-blend-mode: var(--nx-god-blend);
  }
  #nexus-root::before {
    left: 0; width: var(--nx-venus-w);
    background-image: url("${VENUS_DATA_URI}"); background-position: left bottom;
  }
  #nexus-root::after {
    right: 0; width: var(--nx-disco-w);
    background-image: url("${DISCOBOLUS_DATA_URI}"); background-position: right bottom;
  }
  @media (prefers-color-scheme: dark) { #nexus-root { --nx-god-op: .4; --nx-god-blend: screen; } }
  @media (max-width: 480px) { #nexus-root { --nx-venus-w: 32%; --nx-disco-w: 58%; } }
  #nexus-root > * { position: relative; z-index: 1; }

  .nx-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .nx-date { font-size: 13px; font-weight: 500; color: var(--nx-mut); }
  .nx-seg { display: inline-flex; background: var(--nx-seg); border-radius: 8px; padding: 2px; }
  .nx-seg button { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--nx-mut); padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  .nx-seg button svg { width: 16px; height: 16px; display: block; }
  .nx-seg button:hover { color: var(--nx-ink); }
  .nx-seg button.on { background: var(--nx-segon); color: var(--nx-accent); }

  /* Progress: calorie ring + macro rows on wide (laptop) widths; both goals
     as rings side by side on narrow (phone) widths — swapped by media query,
     not JS, so it re-flows with the host's own viewport/split-screen resize. */
  .nx-prog-wide { display: flex; align-items: center; gap: 22px; margin-bottom: 18px; }
  .nx-prog-narrow { display: none; }
  .nx-ring { flex: 0 0 auto; }
  .nx-ring circle.trk { stroke: var(--nx-track); }
  .nx-ring circle.val { stroke: var(--nx-accent); transition: stroke-dashoffset .5s ease; }
  .nx-ring text.big { fill: var(--nx-num); font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .nx-ring text.sm { fill: var(--nx-faint); font-size: 8px; font-weight: 500; }
  @media (max-width: 480px) {
    .nx-prog-wide { display: none; }
    .nx-prog-narrow { display: block; margin-bottom: 18px; }
    .nx-rings-row { display: flex; justify-content: space-around; gap: 12px; margin-bottom: 14px; }
    .nx-rings-row .nx-ring { width: 96px; height: 96px; }
    .nx-rings-row .nx-ring text.big { font-size: 17px; }
    .nx-ring-cap { text-align: center; font-size: 11px; color: var(--nx-mut); margin-top: 4px; }
  }
  .nx-macros2 { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .nx-m2-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .nx-m2 .lbl { font-size: 12.5px; color: var(--nx-mut); }
  .nx-m2 .val { font-size: 14px; color: var(--nx-num); font-variant-numeric: tabular-nums; }
  .nx-m2 .val b { font-weight: 600; }
  .nx-bar { height: 5px; background: var(--nx-track); border-radius: 3px; margin-top: 6px; overflow: hidden; }
  .nx-bar > i { display: block; height: 100%; background: var(--nx-accent); border-radius: 3px; transition: width .5s ease; }

  /* Two encased boxes: meal list + editor */
  .nx-box { border: 1px solid var(--nx-line); border-radius: 14px; background: var(--nx-boxbg); margin-bottom: 12px; }
  .nx-box.list { padding: 6px 8px 8px; }
  .nx-box.editor { padding: 46px 16px 16px; position: relative; }

  table.nx-tbl { width: 100%; border-collapse: separate; border-spacing: 0; }
  .nx-tbl thead th { font-size: 12px; font-weight: 400; color: var(--nx-faint); text-align: right; padding: 6px 12px 8px 0; font-variant-numeric: tabular-nums; }
  .nx-tbl thead th.l { text-align: left; padding-left: 12px; }
  .nx-tbl tbody td { padding: 12px 0; font-size: 15px; font-weight: 400; vertical-align: middle; line-height: 1.25; }
  .nx-tbl td.num { text-align: right; font-variant-numeric: tabular-nums; color: var(--nx-num); width: 4rem; white-space: nowrap; padding-right: 12px; }
  .nx-tbl td.nm { color: var(--nx-ink); padding-left: 12px; }
  /* Rows become clean rounded pills on hover / when selected — no hard-cornered
     rectangle, no left accent bar. Same radius in both states. */
  tr.nx-tap { cursor: pointer; }
  tr.nx-tap:hover td { background: var(--nx-hover); }
  tr.nx-sel td { background: var(--nx-selbg); }
  tr.nx-tap:hover td:first-child, tr.nx-sel td:first-child { border-top-left-radius: 11px; border-bottom-left-radius: 11px; }
  tr.nx-tap:hover td:last-child, tr.nx-sel td:last-child { border-top-right-radius: 11px; border-bottom-right-radius: 11px; }
  .nx-empty { color: var(--nx-faint); font-size: 14px; padding: 12px; }

  .nx-name { width: 100%; padding: 10px 12px; font-size: 15px; color: var(--nx-ink); background: transparent; border: 1px solid var(--nx-fieldline); border-radius: 10px; outline: none; margin-bottom: 12px; }
  .nx-macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .nx-macro { display: flex; flex-direction: column; gap: 5px; }
  .nx-macro span { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--nx-faint); }
  .nx-macro input { width: 100%; padding: 9px 10px; font-size: 15px; font-variant-numeric: tabular-nums; color: var(--nx-ink); background: transparent; border: 1px solid var(--nx-fieldline); border-radius: 10px; outline: none; }
  .nx-macro input:focus, .nx-name:focus { border-color: var(--nx-accent); }
  .nx-btns { display: flex; justify-content: flex-end; margin-top: 14px; }
  .nx-save { padding: 9px 24px; font-size: 14px; font-weight: 600; border-radius: 10px; border: 0; cursor: pointer; background: var(--nx-accent); color: var(--nx-onacc); }
  .nx-save:disabled { opacity: .5; cursor: default; }
  .nx-err { color: #e5695f; font-size: 12px; margin-top: 9px; }
  /* Editor close — a plain X in the header gap at the box's top-right (the
     extra top padding on .nx-box.editor opens the space). No chip, no popup. */
  .nx-editor-x { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--nx-faint); cursor: pointer; }
  .nx-editor-x svg { width: 16px; height: 16px; display: block; }
  .nx-editor-x:hover { color: var(--nx-ink); background: var(--nx-hover); }
</style>
<script>
(function () {
  var GOAL_KCAL = ${DEFAULT_GOAL_KCAL}, GOAL_PROTEIN = ${DEFAULT_GOAL_PROTEIN};
  var root = document.getElementById("nexus-root");
  var live = false;
  var db = null;
  var selectedId = null;
  var currentData = null;
  var saveError = "";
  var view = "food";
  var editorClosed = false;

  function fmtDate(d) {
    try {
      var dt = new Date(d + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(x) { return typeof x === "number" ? Math.round(x * 10) / 10 : 0; }
  function num(v) { var x = parseFloat(v); return isFinite(x) && x >= 0 ? x : 0; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mealName(m) {
    if (m.meal_type && (!m.items || !m.items.length)) return m.meal_type;
    var names = (m.items || []).map(function (i) { return i.name; }).filter(Boolean).join(", ");
    return (m.meal_type ? m.meal_type + ": " : "") + names;
  }
  function findMeal(id) {
    var meals = (currentData && currentData.meals) || [];
    for (var i = 0; i < meals.length; i++) if (String(meals[i].id) === String(id)) return meals[i];
    return null;
  }
  function foodTotals(meals) {
    var t = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    (meals || []).forEach(function (m) {
      var mt = m.totals || {};
      t.calories += mt.calories || 0; t.protein_g += mt.protein_g || 0;
      t.carbs_g += mt.carbs_g || 0; t.fat_g += mt.fat_g || 0;
    });
    return t;
  }

  function ring(pct, big, small) {
    var r = 42, c = 2 * Math.PI * r, off = c * (1 - clamp01(pct));
    return '<svg class="nx-ring" width="118" height="118" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="trk" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="9"/>' +
      '<circle class="val" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="9" stroke-linecap="round" ' +
        'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 50 50)"/>' +
      '<text class="big" x="50" y="49" text-anchor="middle">' + big + '</text>' +
      '<text class="sm" x="50" y="62" text-anchor="middle">' + small + '</text></svg>';
  }
  function progRow(label, valHtml, pct, showBar) {
    var h = '<div class="nx-m2"><div class="nx-m2-top"><span class="lbl">' + label + '</span><span class="val">' + valHtml + '</span></div>';
    if (showBar) h += '<div class="nx-bar"><i style="width:' + Math.round(clamp01(pct) * 100) + '%"></i></div>';
    return h + "</div>";
  }

  function macroInput(id, label, val) {
    return '<label class="nx-macro"><span>' + label + '</span>' +
      '<input id="' + id + '" type="number" inputmode="decimal" min="0" step="1" value="' + n(val) + '"/></label>';
  }
  function editorBox(m) {
    var id = m.id, t = m.totals || {};
    var firstName = (m.items && m.items[0] && m.items[0].name) || m.meal_type || "";
    var h = '<div class="nx-box editor">';
    h += '<button class="nx-editor-x" data-close="1" aria-label="Close editor" title="Close">' + X_SVG + '</button>';
    h += '<input class="nx-name" id="nx-name-' + esc(id) + '" value="' + esc(firstName) + '" placeholder="What was it?"/>';
    h += '<div class="nx-macros">';
    h += macroInput("nx-kcal-" + esc(id), "kcal", t.calories);
    h += macroInput("nx-p-" + esc(id), "protein", t.protein_g);
    h += macroInput("nx-c-" + esc(id), "carbs", t.carbs_g);
    h += macroInput("nx-f-" + esc(id), "fat", t.fat_g);
    h += "</div>";
    if (saveError) h += '<div class="nx-err">' + esc(saveError) + "</div>";
    h += '<div class="nx-btns"><button class="nx-save" id="nx-save-' + esc(id) + '" data-save="' + esc(id) + '">Save</button></div>';
    return h + "</div>";
  }

  function render(data) {
    if (!data) { root.innerHTML = ""; return; }
    // The goal in effect on the rendered day — server-supplied per-day via
    // getGoalForDate, so a future history/date-picker view will show
    // whatever goal was actually active that day, not today's. Falls back to
    // the same defaults the server uses for a user who's never set one.
    if (data.goal) {
      if (typeof data.goal.calories === "number") GOAL_KCAL = data.goal.calories;
      if (typeof data.goal.protein_g === "number") GOAL_PROTEIN = data.goal.protein_g;
    }
    var period = data.period || {};
    var single = period.from === period.to;
    var title = single ? fmtDate(period.from) : fmtDate(period.from) + " – " + fmtDate(period.to);
    var workouts = data.workouts || [];
    var meals = data.meals || [];
    var weights = data.weights || [];
    var both = meals.length > 0 && workouts.length > 0;
    if (view === "workout" && !workouts.length) view = "food";

    var h = '<div class="nx-top"><span class="nx-date">' + esc(title) + "</span>";
    if (both) {
      h += '<span class="nx-seg">' +
        '<button data-view="food" aria-label="Food" title="Food"' + (view === "food" ? ' class="on"' : "") + ">" + FLAME_SVG + "</button>" +
        '<button data-view="workout" aria-label="Workout" title="Workout"' + (view === "workout" ? ' class="on"' : "") + ">" + DUMBBELL_SVG + "</button></span>";
    }
    h += "</div>";

    if (view === "workout") {
      var totalSets = 0;
      workouts.forEach(function (w) { totalSets += (w.sets || []).length; });
      h += '<div class="nx-prog-wide"><div class="nx-macros2">' +
        progRow("Exercises", "<b>" + workouts.length + "</b>", 0, false) +
        progRow("Sets", "<b>" + totalSets + "</b>", 0, false) +
        (weights.length ? progRow("Weight", "<b>" + n(weights[0].weight_kg) + "</b> kg", 0, false) : "") +
        "</div></div>";
      h += '<div class="nx-box list"><table class="nx-tbl"><thead><tr><th class="l"></th><th>Sets</th><th>Top</th></tr></thead><tbody>';
      workouts.forEach(function (w) {
        var sets = Array.isArray(w.sets) ? w.sets : [];
        var top = null;
        sets.forEach(function (s) { if (s.weight_kg != null && (top == null || s.weight_kg > top)) top = s.weight_kg; });
        h += '<tr><td class="nm">' + esc(w.exercise || w.exercise_key) + '</td>' +
          '<td class="num">' + (sets.length || (w.duration_min ? w.duration_min + "m" : "-")) + '</td>' +
          '<td class="num">' + (top != null ? top + "kg" : "-") + "</td></tr>";
      });
      h += "</tbody></table></div>";
      root.innerHTML = h;
      return;
    }

    // FOOD view — calorie ring + protein bar on wide widths; calorie ring +
    // protein ring side by side on narrow (phone) widths. Both render into
    // the DOM; CSS picks one per breakpoint (see .nx-prog-wide/-narrow).
    var t = foodTotals(meals);
    h += '<div class="nx-prog-wide">';
    h += ring(t.calories / GOAL_KCAL, n(t.calories), "of " + GOAL_KCAL);
    h += '<div class="nx-macros2">';
    h += progRow("Protein", "<b>" + n(t.protein_g) + "</b> / " + GOAL_PROTEIN + "g", t.protein_g / GOAL_PROTEIN, true);
    h += progRow("Carbs", "<b>" + n(t.carbs_g) + "</b> g", 0, false);
    h += progRow("Fat", "<b>" + n(t.fat_g) + "</b> g", 0, false);
    h += "</div></div>";

    // Phone layout: both goals as rings, no carbs/fat — nobody's reading
    // those numbers off a two-inch card.
    h += '<div class="nx-prog-narrow">';
    h += '<div class="nx-rings-row">';
    h += '<div>' + ring(t.calories / GOAL_KCAL, n(t.calories), "of " + GOAL_KCAL) + '<div class="nx-ring-cap">Calories</div></div>';
    h += '<div>' + ring(t.protein_g / GOAL_PROTEIN, n(t.protein_g) + "g", "of " + GOAL_PROTEIN + "g") + '<div class="nx-ring-cap">Protein</div></div>';
    h += '</div></div>';

    if (meals.length) {
      var showId = findMeal(selectedId) ? selectedId : meals[0].id;
      h += '<div class="nx-box list"><table class="nx-tbl"><thead><tr><th class="l"></th><th>kcal</th><th>protein</th></tr></thead><tbody>';
      meals.forEach(function (m) {
        var mt = m.totals || {};
        var sel = String(m.id) === String(showId);
        h += '<tr class="nx-tap' + (sel ? " nx-sel" : "") + '" data-select="' + esc(m.id) + '">' +
          '<td class="nm">' + esc(mealName(m)) + '</td>' +
          '<td class="num">' + n(mt.calories) + '</td>' +
          '<td class="num">' + n(mt.protein_g) + "g</td></tr>";
      });
      h += "</tbody></table></div>";
      var selMeal = findMeal(showId) || meals[0];
      if (selMeal && !editorClosed) h += editorBox(selMeal);
    } else if (!workouts.length && !weights.length) {
      h += '<div class="nx-box list"><div class="nx-empty">Nothing logged yet' + (single ? " today" : "") + ". Tell ChatGPT what you ate.</div></div>";
    }
    root.innerHTML = h;
  }

  function applyData(data) {
    currentData = data;
    var ae = document.activeElement;
    var typing = ae && ae.closest && ae.closest(".nx-box.editor");
    if (!typing) render(data);
  }

  function rowsToData(entries, period) {
    var d = { period: period, workouts: [], meals: [], weights: [] };
    (entries || []).forEach(function (r) {
      var date = new Date(r.entry_date).toISOString().slice(0, 10);
      var base = Object.assign({ id: r.id, date: date }, r.data || {});
      if (r.type === "workout") d.workouts.push(base);
      else if (r.type === "meal") d.meals.push(base);
      else if (r.type === "weight") d.weights.push(base);
    });
    return d;
  }

  function writeMeal(id, data) {
    if (db) return Promise.resolve(db.transact(db.tx.entries[id].update({ data: data, updated_at: Date.now() })));
    if (window.openai && typeof window.openai.callTool === "function") return window.openai.callTool("nexus_update_entry", { entry_id: id, data: data });
    return Promise.reject(new Error("No connection — reopen the app and try again."));
  }
  function saveMeal(id) {
    var m = findMeal(id);
    if (!m) { render(currentData); return; }
    var name = (document.getElementById("nx-name-" + id).value || "").trim() || "Meal";
    var totals = {
      calories: Math.round(num(document.getElementById("nx-kcal-" + id).value)),
      protein_g: Math.round(num(document.getElementById("nx-p-" + id).value) * 10) / 10,
      carbs_g: Math.round(num(document.getElementById("nx-c-" + id).value) * 10) / 10,
      fat_g: Math.round(num(document.getElementById("nx-f-" + id).value) * 10) / 10,
    };
    var quantity = (m.items && m.items[0] && m.items[0].quantity != null) ? m.items[0].quantity : 1;
    var data = { items: [Object.assign({ name: name, quantity: quantity }, totals)], totals: totals };
    if (m.meal_type) data.meal_type = m.meal_type;
    saveError = "";
    var btn = document.getElementById("nx-save-" + id);
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    writeMeal(id, data).then(function () {
      m.items = data.items; m.totals = totals; render(currentData);
    }).catch(function (e) {
      saveError = (e && e.message) || "Couldn't save. Try again.";
      render(currentData);
    });
  }

  root.addEventListener("click", function (e) {
    var t = e.target, c = t.closest ? function (s) { return t.closest(s); } : function () { return null; };
    var save = c("[data-save]"); if (save) { e.preventDefault(); saveMeal(save.getAttribute("data-save")); return; }
    var close = c("[data-close]"); if (close) { e.preventDefault(); editorClosed = true; saveError = ""; render(currentData); return; }
    var vw = c("[data-view]"); if (vw) { view = vw.getAttribute("data-view"); saveError = ""; render(currentData); return; }
    var sel = c("[data-select]"); if (sel) { selectedId = sel.getAttribute("data-select"); editorClosed = false; saveError = ""; render(currentData); }
  });

  function initialState(out) {
    if (out && Array.isArray(out.logged)) {
      var loggedMeal = null, hasWorkout = false, hasMeal = false;
      out.logged.forEach(function (l) {
        if (!l) return;
        if (l.entry_type === "meal") { hasMeal = true; if (!loggedMeal) loggedMeal = l.id; }
        if (l.entry_type === "workout") hasWorkout = true;
      });
      if (hasWorkout && !hasMeal) view = "workout";
      else if (loggedMeal) selectedId = loggedMeal;
    }
  }

  var liveStarted = false;
  function currentPeriod() {
    var out = (window.openai && window.openai.toolOutput) || null;
    if (out && out.period) return out.period;
    var today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  }
  function tryLive() {
    if (liveStarted) return;
    var meta = (window.openai && window.openai.toolResponseMetadata) || {};
    var w = meta["nexus/widget"];
    if (!w || !w.app_id || !w.token || typeof instant === "undefined") return;
    liveStarted = true;
    var period = currentPeriod();
    try {
      db = instant.init({ appId: w.app_id });
      db.auth.signInWithToken(w.token).then(function () {
        var from = Date.parse(period.from + "T00:00:00Z");
        var to = Date.parse(period.to + "T00:00:00Z");
        db.subscribeQuery(
          { entries: { $: { where: { and: [{ entry_date: { $gte: from } }, { entry_date: { $lte: to } }] }, order: { entry_date: "desc" } } } },
          function (resp) { if (resp.error || !resp.data) return; live = true; applyData(rowsToData(resp.data.entries, period)); }
        );
      }).catch(function () { db = null; liveStarted = false; });
    } catch (e) { db = null; liveStarted = false; }
  }

  function boot() {
    var out = (window.openai && window.openai.toolOutput) || null;
    var period = currentPeriod();
    initialState(out);
    applyData(out && out.workouts ? out : { period: period, workouts: [], meals: [], weights: [] });
    tryLive();
  }

  if (window.openai && window.openai.toolOutput) boot();
  var painted = false;
  window.addEventListener("openai:set_globals", function () {
    if (!painted && window.openai && window.openai.toolOutput) { painted = true; boot(); }
    else tryLive();
  });
  window.addEventListener("load", tryLive);
})();
</script>`;
  // The InstantDB library is appended by mcp.ts (inlined from the vendored
  // bundle) — no external <script src>, so nothing in the render path can be
  // slow, blocked, or 404.
}
