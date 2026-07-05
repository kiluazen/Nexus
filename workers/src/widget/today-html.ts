// The Nexus day card — rendered natively inside ChatGPT, styled after
// Perplexity Finance's dark tables: transparent background, clean aligned
// rows, muted headers, tabular numbers, a single green accent on the numbers
// that matter (kcal + protein).
//
// It's calorie-first. Food view shows the macro totals and an editable meal
// table; the meal you just logged opens in edit mode so adjusting the estimate
// is self-evident. Workouts get their own view, auto-selected when you log a
// workout, with a Food/Workout toggle when the day has both. Only meals are
// editable (this is a calorie tool); workouts are display-only.
//
// ChatGPT caches a widget resource by its ui:// URI (it snapshots the HTML).
// BUMP this suffix (…-v2) on breaking widget changes so clients fetch fresh.
export const WIDGET_URI = "ui://widget/nexus-today.html";

export function widgetHtml(): string {
  return `<div id="nexus-root"></div>
<style>
  :root {
    --nx-ink: #1a1a1a; --nx-mut: #5f5f5f; --nx-faint: #9a9a9a;
    --nx-accent: #0f9d63; --nx-line: rgba(0,0,0,.09); --nx-hover: rgba(0,0,0,.04);
    --nx-fieldline: rgba(0,0,0,.16); --nx-seg: rgba(0,0,0,.05); --nx-segon: rgba(0,0,0,.10);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --nx-ink: #ececec; --nx-mut: #9b9b9b; --nx-faint: #6f6f6f;
      --nx-accent: #34d399; --nx-line: rgba(255,255,255,.07); --nx-hover: rgba(255,255,255,.04);
      --nx-fieldline: rgba(255,255,255,.15); --nx-seg: rgba(255,255,255,.05); --nx-segon: rgba(255,255,255,.12);
    }
  }
  * { box-sizing: border-box; }
  #nexus-root { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--nx-ink); background: transparent; }
  .nx-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .nx-date { font-size: 13px; font-weight: 600; color: var(--nx-mut); }
  .nx-seg { display: inline-flex; background: var(--nx-seg); border-radius: 8px; padding: 2px; }
  .nx-seg button { border: 0; background: transparent; color: var(--nx-mut); font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 6px; cursor: pointer; }
  .nx-seg button.on { background: var(--nx-segon); color: var(--nx-ink); }
  .nx-stats { display: flex; gap: 26px; margin-bottom: 18px; }
  .nx-s { display: flex; flex-direction: column; gap: 2px; }
  .nx-s b { font-size: 23px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; letter-spacing: -.015em; }
  .nx-s.hi b { color: var(--nx-accent); }
  .nx-s span { font-size: 11px; color: var(--nx-faint); }
  table.nx-tbl { width: 100%; border-collapse: collapse; }
  .nx-tbl thead th { font-size: 10.5px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--nx-faint); text-align: right; padding: 0 0 8px; font-variant-numeric: tabular-nums; }
  .nx-tbl thead th.l { text-align: left; }
  .nx-tbl tbody td { padding: 11px 0; border-top: 1px solid var(--nx-line); font-size: 14.5px; vertical-align: middle; }
  .nx-tbl td.num { text-align: right; font-variant-numeric: tabular-nums; color: var(--nx-mut); width: 3.6rem; white-space: nowrap; }
  .nx-tbl td.nm { color: var(--nx-ink); }
  tr.nx-tap { cursor: pointer; }
  tr.nx-tap:hover td { background: var(--nx-hover); }
  .nx-empty { color: var(--nx-faint); font-size: 13.5px; padding: 12px 0; }
  .nx-edit td { padding: 0 !important; border-top: 1px solid var(--nx-line) !important; }
  .nx-editbox { padding: 13px 2px; }
  .nx-name { width: 100%; padding: 9px 11px; font-size: 14.5px; color: var(--nx-ink); background: transparent; border: 1px solid var(--nx-fieldline); border-radius: 9px; outline: none; margin-bottom: 10px; }
  .nx-macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .nx-macro { display: flex; flex-direction: column; gap: 4px; }
  .nx-macro span { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: var(--nx-faint); }
  .nx-macro input { width: 100%; padding: 8px 9px; font-size: 15px; font-variant-numeric: tabular-nums; color: var(--nx-ink); background: transparent; border: 1px solid var(--nx-fieldline); border-radius: 9px; outline: none; }
  .nx-macro input:focus, .nx-name:focus { border-color: var(--nx-accent); }
  .nx-btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
  .nx-btns button { padding: 8px 18px; font-size: 13.5px; font-weight: 600; border-radius: 9px; border: 0; cursor: pointer; }
  .nx-cancel { background: transparent; color: var(--nx-mut); }
  .nx-save { background: var(--nx-accent); color: #05271a; }
  .nx-save:disabled { opacity: .5; cursor: default; }
  .nx-err { color: #e5695f; font-size: 12px; margin-top: 8px; }
</style>
<script>
(function () {
  var root = document.getElementById("nexus-root");
  var live = false;
  var db = null;
  var editingId = null;
  var currentData = null;
  var saveError = "";
  var view = "food";

  function fmtDate(d) {
    try {
      var dt = new Date(d + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(x) { return typeof x === "number" ? Math.round(x * 10) / 10 : 0; }
  function num(v) { var x = parseFloat(v); return isFinite(x) && x >= 0 ? x : 0; }
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

  function macroInput(id, label, val) {
    return '<label class="nx-macro"><span>' + label + '</span>' +
      '<input id="' + id + '" type="number" inputmode="decimal" min="0" step="1" value="' + n(val) + '"/></label>';
  }
  function mealEditor(m) {
    var id = m.id, t = m.totals || {};
    var firstName = (m.items && m.items[0] && m.items[0].name) || m.meal_type || "";
    var h = '<tr class="nx-edit"><td colspan="3"><div class="nx-editbox">';
    h += '<input class="nx-name" id="nx-name-' + esc(id) + '" value="' + esc(firstName) + '" placeholder="What was it?"/>';
    h += '<div class="nx-macros">';
    h += macroInput("nx-kcal-" + esc(id), "kcal", t.calories);
    h += macroInput("nx-p-" + esc(id), "protein", t.protein_g);
    h += macroInput("nx-c-" + esc(id), "carbs", t.carbs_g);
    h += macroInput("nx-f-" + esc(id), "fat", t.fat_g);
    h += "</div>";
    if (saveError) h += '<div class="nx-err">' + esc(saveError) + "</div>";
    h += '<div class="nx-btns"><button class="nx-cancel" data-cancel="1">Cancel</button>' +
      '<button class="nx-save" id="nx-save-' + esc(id) + '" data-save="' + esc(id) + '">Save</button></div>';
    return h + "</div></td></tr>";
  }

  function stat(hi, value, label) {
    return '<div class="nx-s' + (hi ? " hi" : "") + '"><b>' + value + "</b><span>" + label + "</span></div>";
  }

  function render(data) {
    if (!data) { root.innerHTML = ""; return; }
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
        '<button data-view="food"' + (view === "food" ? ' class="on"' : "") + ">Food</button>" +
        '<button data-view="workout"' + (view === "workout" ? ' class="on"' : "") + ">Workout</button></span>";
    }
    h += "</div>";

    if (view === "workout") {
      var totalSets = 0;
      workouts.forEach(function (w) { totalSets += (w.sets || []).length; });
      h += '<div class="nx-stats">' + stat(true, workouts.length, "exercises") + stat(true, totalSets, "sets");
      if (weights.length) h += stat(false, n(weights[0].weight_kg) + "kg", "weight");
      h += "</div>";
      h += '<table class="nx-tbl"><thead><tr><th class="l">Exercise</th><th>Sets</th><th>Top</th></tr></thead><tbody>';
      workouts.forEach(function (w) {
        var sets = Array.isArray(w.sets) ? w.sets : [];
        var top = null;
        sets.forEach(function (s) { if (s.weight_kg != null && (top == null || s.weight_kg > top)) top = s.weight_kg; });
        h += '<tr><td class="nm">' + esc(w.exercise || w.exercise_key) + '</td>' +
          '<td class="num">' + (sets.length || (w.duration_min ? w.duration_min + "m" : "-")) + '</td>' +
          '<td class="num">' + (top != null ? top + "kg" : "-") + "</td></tr>";
      });
      h += "</tbody></table>";
      root.innerHTML = h;
      return;
    }

    // Food view (calorie-first)
    var t = foodTotals(meals);
    h += '<div class="nx-stats">' +
      stat(true, n(t.calories), "kcal") + stat(true, n(t.protein_g) + "g", "protein") +
      stat(false, n(t.carbs_g) + "g", "carbs") + stat(false, n(t.fat_g) + "g", "fat") + "</div>";

    if (meals.length) {
      h += '<table class="nx-tbl"><thead><tr><th class="l">Meal</th><th>kcal</th><th>protein</th></tr></thead><tbody>';
      meals.forEach(function (m) {
        if (String(m.id) === String(editingId)) { h += mealEditor(m); return; }
        var mt = m.totals || {};
        h += '<tr class="nx-tap" data-edit="' + esc(m.id) + '">' +
          '<td class="nm">' + esc(mealName(m)) + '</td>' +
          '<td class="num">' + n(mt.calories) + '</td>' +
          '<td class="num">' + n(mt.protein_g) + "g</td></tr>";
      });
      h += "</tbody></table>";
    } else if (!workouts.length && !weights.length) {
      h += '<div class="nx-empty">Nothing logged yet' + (single ? " today" : "") + ". Tell ChatGPT what you ate.</div>";
    }
    root.innerHTML = h;
  }

  function applyData(data) { currentData = data; if (!editingId) render(data); }

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
    if (!m) { editingId = null; render(currentData); return; }
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
      m.items = data.items; m.totals = totals; editingId = null; render(currentData);
    }).catch(function (e) {
      saveError = (e && e.message) || "Couldn't save. Try again.";
      if (btn) { btn.disabled = false; btn.textContent = "Save"; }
      render(currentData);
    });
  }

  root.addEventListener("click", function (e) {
    var t = e.target, c = t.closest ? function (s) { return t.closest(s); } : function () { return null; };
    var save = c("[data-save]"); if (save) { e.preventDefault(); saveMeal(save.getAttribute("data-save")); return; }
    var cancel = c("[data-cancel]"); if (cancel) { e.preventDefault(); editingId = null; saveError = ""; render(currentData); return; }
    var vw = c("[data-view]"); if (vw) { view = vw.getAttribute("data-view"); editingId = null; saveError = ""; render(currentData); return; }
    var edit = c("[data-edit]"); if (edit) { editingId = edit.getAttribute("data-edit"); saveError = ""; render(currentData); }
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
      else if (loggedMeal) editingId = loggedMeal; // auto-open the meal just logged
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
    if (editingId) render(currentData);
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
</script>
<script src="https://unpkg.com/@instantdb/core@1.0.49/dist/standalone/index.umd.cjs" defer></script>`;
}
