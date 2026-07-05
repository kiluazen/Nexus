// The Nexus widget: a compact day/period card rendered inside ChatGPT.
//
// Render strategy is progressive enhancement:
//   1. Paint immediately from window.openai.toolOutput (structuredContent).
//   2. Try to go live: load @instantdb/core (UMD), sign in with the token the
//      Worker minted into toolResponseMetadata, subscribeQuery the same period.
//      If the sandbox CSP blocks the socket, the static paint stands.
//
// Meals are editable in place: tap one, fix the name / calories / macros, hit
// Save. The save writes straight to InstantDB from the widget (the "instant"
// path — no model round-trip) and the live subscription re-renders the card.
// The model's estimate is a draft; the human confirms it here.
// ChatGPT caches a widget resource by its ui:// URI (it snapshots the HTML).
// When the widget's markup/JS changes in a breaking way, BUMP this suffix
// (…-v2, …-v3) so every client fetches the fresh copy instead of a stale cache.
// Users still need to hit Refresh on the connector to pull the new tool list.
export const WIDGET_URI = "ui://widget/nexus-today.html";

export function widgetHtml(): string {
  return `<div id="nexus-root"></div>
<style>
  :root {
    --nx-bg: #f5f2ea; --nx-card: #fffdf8; --nx-ink: #3a3838; --nx-body: #525051;
    --nx-mut: #9b9692; --nx-line: #e5dfd2; --nx-accent: #3a3838; --nx-field: #f3efe6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --nx-bg: transparent; --nx-card: #23211e; --nx-ink: #f0ede4; --nx-body: #cfcabe;
      --nx-mut: #8d887e; --nx-line: #3a3733; --nx-accent: #f0ede4; --nx-field: #2c2a26;
    }
  }
  #nexus-root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--nx-body); }
  * { box-sizing: border-box; }
  .nx-card { background: var(--nx-card); border: 1px solid var(--nx-line); border-radius: 14px; padding: 14px 16px; }
  .nx-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .nx-title { color: var(--nx-ink); font-weight: 700; font-size: 15px; }
  .nx-live { font-size: 11px; color: var(--nx-mut); }
  .nx-live.on { color: #4a8a5c; }
  .nx-totals { display: flex; gap: 14px; padding: 8px 0 10px; border-bottom: 1px solid var(--nx-line); margin-bottom: 8px; flex-wrap: wrap; }
  .nx-t { display: flex; flex-direction: column; }
  .nx-t b { color: var(--nx-ink); font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .nx-t span { font-size: 11px; color: var(--nx-mut); }
  .nx-sec { margin: 8px 0 2px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--nx-mut); }
  .nx-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 13.5px; align-items: baseline; }
  .nx-row .name { color: var(--nx-ink); font-weight: 500; }
  .nx-row .meta { color: var(--nx-mut); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nx-meal { cursor: pointer; border-radius: 8px; margin: 0 -6px; padding: 5px 6px; }
  .nx-meal:hover { background: var(--nx-field); }
  .nx-pencil { color: var(--nx-mut); font-size: 12px; opacity: .55; margin-left: 6px; }
  .nx-empty { color: var(--nx-mut); font-size: 13px; padding: 6px 0; }
  .nx-edit { background: var(--nx-field); border: 1px solid var(--nx-line); border-radius: 10px; padding: 10px; margin: 4px -6px; }
  .nx-in-name { width: 100%; padding: 7px 9px; font-size: 13.5px; color: var(--nx-ink); background: var(--nx-card); border: 1px solid var(--nx-line); border-radius: 7px; outline: none; margin-bottom: 8px; }
  .nx-macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .nx-macro { display: flex; flex-direction: column; gap: 2px; }
  .nx-macro span { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--nx-mut); }
  .nx-macro input { width: 100%; padding: 6px 7px; font-size: 14px; font-variant-numeric: tabular-nums; color: var(--nx-ink); background: var(--nx-card); border: 1px solid var(--nx-line); border-radius: 7px; outline: none; }
  .nx-macro input:focus, .nx-in-name:focus { border-color: var(--nx-mut); }
  .nx-editbtns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 9px; }
  .nx-editbtns button { padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 7px; border: 0; cursor: pointer; }
  .nx-cancel { background: transparent; color: var(--nx-mut); }
  .nx-save { background: var(--nx-accent); color: var(--nx-card); }
  .nx-save:disabled { opacity: .5; cursor: default; }
  .nx-err { color: #b0504a; font-size: 12px; margin-top: 6px; }
</style>
<script>
(function () {
  var root = document.getElementById("nexus-root");
  var live = false;
  var db = null;            // set once the live InstantDB session connects
  var editingId = null;     // id of the meal currently being edited
  var currentData = null;   // latest data we've rendered from
  var saveError = "";

  function fmtDate(d) {
    try {
      var dt = new Date(d + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
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

  function macroInput(id, label, val) {
    return '<label class="nx-macro"><span>' + label + '</span>' +
      '<input id="' + id + '" type="number" inputmode="decimal" min="0" step="1" value="' + n(val) + '"/></label>';
  }

  function mealEditor(m) {
    var id = m.id;
    var t = m.totals || {};
    var firstName = (m.items && m.items[0] && m.items[0].name) || m.meal_type || "";
    var h = '<div class="nx-edit">';
    h += '<input class="nx-in-name" id="nx-name-' + esc(id) + '" value="' + esc(firstName) + '" placeholder="What was it?"/>';
    h += '<div class="nx-macros">';
    h += macroInput("nx-kcal-" + esc(id), "kcal", t.calories);
    h += macroInput("nx-p-" + esc(id), "protein", t.protein_g);
    h += macroInput("nx-c-" + esc(id), "carbs", t.carbs_g);
    h += macroInput("nx-f-" + esc(id), "fat", t.fat_g);
    h += "</div>";
    if (saveError) h += '<div class="nx-err">' + esc(saveError) + "</div>";
    h += '<div class="nx-editbtns">' +
      '<button class="nx-cancel" data-cancel="1">Cancel</button>' +
      '<button class="nx-save" id="nx-save-' + esc(id) + '" data-save="' + esc(id) + '">Save</button></div>';
    h += "</div>";
    return h;
  }

  function render(data) {
    if (!data) { root.innerHTML = ""; return; }
    var period = data.period || {};
    var single = period.from === period.to;
    var title = single ? fmtDate(period.from) : fmtDate(period.from) + " – " + fmtDate(period.to);
    var workouts = data.workouts || [];
    var meals = data.meals || [];
    var weights = data.weights || [];

    var totals = data.day_totals;
    if (!totals) {
      var cal = 0, pro = 0, sets = 0;
      meals.forEach(function (m) { var t = m.totals || {}; cal += t.calories || 0; pro += t.protein_g || 0; });
      workouts.forEach(function (w) { sets += (w.sets || []).length; });
      totals = { calories: cal, protein_g: pro, total_sets: sets };
    }

    var h = '<div class="nx-card">';
    h += '<div class="nx-head"><span class="nx-title">' + esc(title) + '</span>';
    h += '<span class="nx-live' + (live ? " on" : "") + '">' + (live ? "● live" : "Nexus") + "</span></div>";

    h += '<div class="nx-totals">';
    h += '<div class="nx-t"><b>' + n(totals.calories) + "</b><span>kcal</span></div>";
    h += '<div class="nx-t"><b>' + n(totals.protein_g) + "g</b><span>protein</span></div>";
    h += '<div class="nx-t"><b>' + (totals.total_sets || 0) + "</b><span>sets</span></div>";
    if (weights.length > 0) {
      h += '<div class="nx-t"><b>' + n(weights[0].weight_kg) + "kg</b><span>weight</span></div>";
    }
    h += "</div>";

    if (workouts.length) {
      h += '<div class="nx-sec">Workouts</div>';
      workouts.forEach(function (w) {
        var meta = [];
        if (Array.isArray(w.sets) && w.sets.length) {
          var top = null;
          w.sets.forEach(function (s) { if (s.weight_kg != null && (top == null || s.weight_kg > top)) top = s.weight_kg; });
          meta.push(w.sets.length + " sets" + (top != null ? " · top " + top + "kg" : ""));
        }
        if (w.duration_min) meta.push(w.duration_min + " min");
        if (w.distance_km) meta.push(w.distance_km + " km");
        h += '<div class="nx-row"><span class="name">' + esc(w.exercise || w.exercise_key) + '</span><span class="meta">' + esc(meta.join(" · ")) + "</span></div>";
      });
    }
    if (meals.length) {
      h += '<div class="nx-sec">Meals · tap to edit</div>';
      meals.forEach(function (m) {
        if (String(m.id) === String(editingId)) { h += mealEditor(m); return; }
        var t = m.totals || {};
        h += '<div class="nx-row nx-meal" data-edit="' + esc(m.id) + '">' +
          '<span class="name">' + esc(mealName(m)) + '</span>' +
          '<span class="meta">' + n(t.calories) + " kcal · " + n(t.protein_g) + "g" +
          '<span class="nx-pencil">✎</span></span></div>';
      });
    }
    if (!workouts.length && !meals.length && !weights.length) {
      h += '<div class="nx-empty">Nothing logged yet' + (single ? " today" : " in this period") + ". Just tell ChatGPT what you did or ate.</div>";
    }
    h += "</div>";
    root.innerHTML = h;
  }

  // Store the newest data; only repaint when not mid-edit, so a live update
  // can't wipe an open editor out from under the user.
  function applyData(data) {
    currentData = data;
    if (!editingId) render(data);
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

  // --- save path -----------------------------------------------------------
  // Direct InstantDB write when we have a live session (instant, no round-trip);
  // fall back to the update tool if the socket never connected.
  function writeMeal(id, data) {
    if (db) {
      return Promise.resolve(db.transact(db.tx.entries[id].update({ data: data, updated_at: Date.now() })));
    }
    if (window.openai && typeof window.openai.callTool === "function") {
      return window.openai.callTool("nexus_update_entry", { entry_id: id, data: data });
    }
    return Promise.reject(new Error("No connection — reopen the app and try again."));
  }

  function saveMeal(id) {
    var m = findMeal(id);
    if (!m) { editingId = null; render(currentData); return; }
    var name = (document.getElementById("nx-name-" + id).value || "").trim() || "Meal";
    var kcal = num(document.getElementById("nx-kcal-" + id).value);
    var p = num(document.getElementById("nx-p-" + id).value);
    var c = num(document.getElementById("nx-c-" + id).value);
    var f = num(document.getElementById("nx-f-" + id).value);
    var totals = {
      calories: Math.round(kcal),
      protein_g: Math.round(p * 10) / 10,
      carbs_g: Math.round(c * 10) / 10,
      fat_g: Math.round(f * 10) / 10,
    };
    var quantity = (m.items && m.items[0] && m.items[0].quantity != null) ? m.items[0].quantity : 1;
    var data = { items: [Object.assign({ name: name, quantity: quantity }, totals)], totals: totals };
    if (m.meal_type) data.meal_type = m.meal_type;

    saveError = "";
    var btn = document.getElementById("nx-save-" + id);
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    writeMeal(id, data).then(function () {
      // Optimistically patch the local copy so the card reflects the edit
      // immediately; the live subscription (if any) then re-confirms it.
      m.items = data.items; m.totals = totals; if (m.meal_type == null) delete m.meal_type;
      editingId = null;
      render(currentData);
    }).catch(function (e) {
      saveError = (e && e.message) || "Couldn't save. Try again.";
      if (btn) { btn.disabled = false; btn.textContent = "Save"; }
      render(currentData);
    });
  }

  root.addEventListener("click", function (e) {
    var t = e.target;
    var save = t.closest ? t.closest("[data-save]") : null;
    if (save) { e.preventDefault(); saveMeal(save.getAttribute("data-save")); return; }
    var cancel = t.closest ? t.closest("[data-cancel]") : null;
    if (cancel) { e.preventDefault(); editingId = null; saveError = ""; render(currentData); return; }
    var edit = t.closest ? t.closest("[data-edit]") : null;
    if (edit) { editingId = edit.getAttribute("data-edit"); saveError = ""; render(currentData); }
  });

  // --- live + boot ---------------------------------------------------------
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
          function (resp) {
            if (resp.error || !resp.data) return;
            live = true;
            applyData(rowsToData(resp.data.entries, period));
          }
        );
      }).catch(function () { db = null; liveStarted = false; /* static paint + tool-path save still work */ });
    } catch (e) { db = null; liveStarted = false; }
  }

  function boot() {
    var out = (window.openai && window.openai.toolOutput) || null;
    var period = currentPeriod();
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
</script>
<script src="https://unpkg.com/@instantdb/core@1.0.49/dist/standalone/index.umd.cjs" defer></script>`;
}
