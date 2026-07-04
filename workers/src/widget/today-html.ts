// The Nexus widget: a compact day/period card rendered inside ChatGPT.
//
// Render strategy is progressive enhancement:
//   1. Paint immediately from window.openai.toolOutput (structuredContent).
//   2. Try to go live: load @instantdb/core (UMD), sign in with the token the
//      Worker minted into toolResponseMetadata, subscribeQuery the same
//      period. If the sandbox CSP blocks the socket, the static paint stands.
// The live path is what makes logging feel instant: say "had a masala
// omelette", and the card updates the moment the write syncs.
export const WIDGET_URI = "ui://widget/nexus-today.html";

export function widgetHtml(): string {
  return `<div id="nexus-root"></div>
<style>
  :root {
    --nx-bg: #f5f2ea; --nx-card: #fffdf8; --nx-ink: #3a3838; --nx-body: #525051;
    --nx-mut: #9b9692; --nx-line: #e5dfd2; --nx-accent: #3a3838;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --nx-bg: transparent; --nx-card: #23211e; --nx-ink: #f0ede4; --nx-body: #cfcabe;
      --nx-mut: #8d887e; --nx-line: #3a3733; --nx-accent: #f0ede4;
    }
  }
  #nexus-root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--nx-body); }
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
  .nx-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 13.5px; }
  .nx-row .name { color: var(--nx-ink); font-weight: 500; }
  .nx-row .meta { color: var(--nx-mut); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nx-empty { color: var(--nx-mut); font-size: 13px; padding: 6px 0; }
</style>
<script>
(function () {
  var root = document.getElementById("nexus-root");
  var live = false;

  function fmtDate(d) {
    try {
      var dt = new Date(d + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function n(x) { return typeof x === "number" ? Math.round(x * 10) / 10 : 0; }

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
      totals = { calories: cal, protein_g: pro, total_sets: sets, exercises: workouts.length, meals_logged: meals.length };
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
      h += '<div class="nx-sec">Meals</div>';
      meals.forEach(function (m) {
        var items = (m.items || []).map(function (i) { return i.name; }).join(", ");
        var t = m.totals || {};
        h += '<div class="nx-row"><span class="name">' + esc(m.meal_type ? m.meal_type + ": " : "") + esc(items) + '</span><span class="meta">' + n(t.calories) + " kcal · " + n(t.protein_g) + "g</span></div>";
      });
    }
    if (!workouts.length && !meals.length && !weights.length) {
      h += '<div class="nx-empty">Nothing logged yet' + (single ? " today" : " in this period") + ". Just tell ChatGPT what you did or ate.</div>";
    }
    h += "</div>";
    root.innerHTML = h;
  }

  function rowsToData(entries, period) {
    var d = { period: period, workouts: [], meals: [], weights: [] };
    (entries || []).forEach(function (r) {
      var date = new Date(r.entry_date).toISOString().slice(0, 10);
      var base = r.data || {};
      if (r.type === "workout") d.workouts.push(Object.assign({ date: date }, base));
      else if (r.type === "meal") d.meals.push(Object.assign({ date: date }, base));
      else if (r.type === "weight") d.weights.push(Object.assign({ date: date }, base));
    });
    return d;
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
      var db = instant.init({ appId: w.app_id });
      db.auth.signInWithToken(w.token).then(function () {
        var from = Date.parse(period.from + "T00:00:00Z");
        var to = Date.parse(period.to + "T00:00:00Z");
        db.subscribeQuery(
          { entries: { $: { where: { and: [{ entry_date: { $gte: from } }, { entry_date: { $lte: to } }] }, order: { entry_date: "desc" } } } },
          function (resp) {
            if (resp.error || !resp.data) return;
            live = true;
            render(rowsToData(resp.data.entries, period));
          }
        );
      }).catch(function () { liveStarted = false; /* static paint stands */ });
    } catch (e) { liveStarted = false; /* static paint stands */ }
  }

  function boot() {
    var out = (window.openai && window.openai.toolOutput) || null;
    var period = currentPeriod();
    render(out && out.workouts ? out : { period: period, workouts: [], meals: [], weights: [] });
    tryLive();
  }

  if (window.openai && window.openai.toolOutput) boot();
  else window.addEventListener("openai:set_globals", boot, { once: true });
  // The UMD script below loads after this inline script — retry live then.
  window.addEventListener("load", tryLive);
})();
</script>
<script src="https://unpkg.com/@instantdb/core@1.0.49/standalone/index.umd.js" defer></script>`;
}
