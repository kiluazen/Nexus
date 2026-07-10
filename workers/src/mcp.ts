import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NexusEnv, NexusProps } from "./types";
import { LogInput, HistoryInput, UpdateInput, FriendsInput, GoalInput } from "./schema/tool-inputs";
import { LogOutput, HistoryOutput, UpdateOutput, FriendsOutput, GoalOutput } from "./schema/tool-outputs";
import { logEntries, getHistory, updateEntry, type UserCtx } from "./data/entries";
import { manageFriends } from "./data/friends";
import { setGoal } from "./data/goals";
import { mintWidgetToken } from "./instant";
import { WIDGET_URI, widgetHtml } from "./widget/today-html";
import { ValidationError, todayUtc } from "./lib/dates";
// The @instantdb/core UMD bundle, vendored and loaded as a string (wrangler
// Text rule). We inline it into the widget so there's no external <script src>
// in the render path — the documented, reliable pattern.
import INSTANT_BUNDLE from "../vendor/instantdb-core.umd.txt";

// The full widget document = app fragment + the inlined InstantDB library.
// Built by concatenation (not template interpolation) because the minified
// bundle contains backticks and ${ that would break a template literal.
function fullWidgetHtml(): string {
  return widgetHtml() + "\n<script>" + INSTANT_BUNDLE + "</script>";
}

// CSP for the widget iframe. connect_domains covers fetch + websocket to
// InstantDB for the live session (both https and wss are declared because
// sandbox handling of wss is inconsistent). No resource_domains needed: the
// library is inlined, not fetched from a CDN.
const WIDGET_CSP = {
  connect_domains: ["https://api.instantdb.com", "wss://api.instantdb.com"],
};

// Shared so the resource registration and the read callback agree — the MCP
// SDK does not merge registration _meta into read results.
//
// Both the legacy OpenAI-namespaced keys AND the vendor-neutral MCP Apps
// keys are sent. ChatGPT only recognizes its own `openai/*` keys; Claude
// (and other spec-following clients) only recognize `ui.*`. Same values,
// two names, so both hosts can find the widget.
const WIDGET_META = {
  "openai/widgetCSP": WIDGET_CSP,
  "openai/widgetPrefersBorder": true,
  // Required for directory submission: pins the origin the widget renders from.
  "openai/widgetDomain": "https://mcp.nexus.kushalsm.com",
  "openai/widgetDescription":
    "Shows the day's logged workouts, meals, calories, and protein, updating live as new entries sync.",
  ui: {
    csp: WIDGET_CSP,
    prefersBorder: true,
  },
};

const SERVER_INSTRUCTIONS = `Nexus is the user's personal workout, meal, and body-weight log.
Logging rules: when the user mentions exercise they DID or food they ATE, call nexus_log_entries immediately — do not ask for confirmation. Estimate calories and macros yourself from the food description before calling; the server never guesses. Reuse exercise_key values from your_exercises in nexus_get_history so progressions cluster (e.g. always "bench_press_barbell", never "bench"). Variants are distinct exercises — barbell vs dumbbell vs incline each get their own key. When you log an exercise_key that is new or listed in uncatalogued_exercises, also pass muscle, pattern, equipment, and is_bodyweight so the server can catalogue it. When a log result carries pr: true on a workout, congratulate the user — they beat their best.
Reading rules: any question about past workouts, meals, calories, weight, or progress is nexus_get_history. Check history before logging when a duplicate seems likely.
Goal rules: only call nexus_set_goal when the user explicitly asks to change a calorie/protein/carb/fat target. Never call it just because they logged something.
Nexus stores data and returns it; you do the coaching, analysis, and conversation.`;

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error("tool error", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export class NexusMcpAgent extends McpAgent<NexusEnv, unknown, NexusProps> {
  server = new McpServer(
    { name: "Nexus – Workout and Nutrition Tracker", version: "4.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  private user(): UserCtx {
    return {
      userId: this.props!.userId,
      email: this.props!.email,
      displayName: this.props!.displayName,
    };
  }

  // One InstantDB token per session, minted lazily. createToken has no TTL or
  // scope, so minting per call would leak orphan refresh tokens; caching on
  // the agent instance (one Durable Object per user session) keeps it to one.
  // We cache the in-flight promise, not just the value, so a call can start
  // the mint (~400ms) in parallel with its data fetch and await it at the end.
  private widgetTokenPromise: Promise<string | null> | null = null;

  private widgetToken(): Promise<string | null> {
    if (!this.widgetTokenPromise) {
      this.widgetTokenPromise = mintWidgetToken(this.env, this.props!.email).catch((e) => {
        console.error("mintWidgetToken failed", e);
        this.widgetTokenPromise = null; // let a later call retry
        return null;
      });
    }
    return this.widgetTokenPromise;
  }

  /** Tool result that also feeds the widget: structuredContent for the model
   *  and iframe, plus a hidden InstantDB token in _meta (widget-only — the
   *  model never sees _meta) so the card can go live. `live` is false for
   *  views the live subscription can't reproduce (a friend's data, or a
   *  type-filtered slice) — the widget then keeps its static paint. */
  private async widgetResult(payload: Record<string, unknown>, opts: { live: boolean }) {
    const token = opts.live ? await this.widgetToken() : null;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      _meta: token
        ? { "nexus/widget": { app_id: this.env.INSTANT_APP_ID, token } }
        : undefined,
    };
  }

  // Data-only result: the model gets structured data to answer from, but NO
  // widget renders. Used for reads so an informational question ("what's my
  // total?") returns a text answer instead of the editable card.
  private dataResult(payload: Record<string, unknown>) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  async init() {
    this.server.registerResource(
      "nexus-today",
      WIDGET_URI,
      {
        title: "Nexus day card",
        description: "Live card showing the user's logged workouts, meals, and totals.",
        // Confirmed via a live tail on prod: the actual ChatGPT MCP client
        // declares clientCapabilities.extensions["io.modelcontextprotocol/ui"]
        // .mimeTypes = ["text/html;profile=mcp-app"] on resources/read — the
        // older "text/html+skybridge" mismatches that and the client aborts
        // the read (responseStreamDisconnected / "Failed to fetch template").
        mimeType: "text/html;profile=mcp-app",
        _meta: WIDGET_META,
      },
      async () => ({
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: "text/html;profile=mcp-app",
            text: fullWidgetHtml(),
            _meta: WIDGET_META,
          },
        ],
      }),
    );

    this.server.registerTool(
      "nexus_log_entries",
      {
        title: "Log to Nexus",
        description:
          "Use this when the user mentions any workout, exercise, gym session, sport, run, or physical activity they did, any meal, food, snack, or drink they consumed, or a body-weight reading. Log it immediately without asking for confirmation; estimate calories and macros yourself first. " +
          "Each entry is a flat object keyed by `type`. A meal is: {\"type\":\"meal\",\"name\":\"Cappuccino\",\"calories\":120,\"protein_g\":6,\"carbs_g\":10,\"fat_g\":6}. " +
          "A workout is: {\"type\":\"workout\",\"exercise\":\"Bench Press - Barbell\",\"exercise_key\":\"bench_press_barbell\",\"sets\":[{\"weight_kg\":60,\"reps\":8}],\"muscle\":\"Chest\",\"pattern\":\"Bench Press\",\"equipment\":\"Barbell\"} — include muscle/pattern/equipment when the exercise_key is new or uncatalogued. " +
          "A weight is: {\"type\":\"weight\",\"weight_kg\":74.5}. " +
          "Do not use for advice, planning, future intentions, or nutrition questions.",
        inputSchema: LogInput.shape,
        outputSchema: LogOutput.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "Logging to Nexus…",
          "openai/toolInvocation/invoked": "Logged to Nexus",
          ui: { resourceUri: WIDGET_URI },
        },
      },
      async (args) => {
        void this.widgetToken(); // warm the token while we write + read back
        const r = await safe(async () => {
          const logged = await logEntries(this.env, this.user(), args);
          // Return the whole day so the model has context and the widget has
          // a complete card even before the live session connects.
          const date = args.date ?? todayUtc();
          const day = await getHistory(this.env, this.user(), { date });
          return { ...logged, ...day };
        });
        // A log always describes the viewer's own single day — safe to go live.
        return r.ok ? this.widgetResult(r.value, { live: true }) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_get_history",
      {
        title: "Get Nexus history",
        description:
          "Use this when the user asks what they ate, what workouts they did, their weight trend, calories, macros, protein, progress on an exercise, or wants a summary of any past day or date range. Also call it before logging when a duplicate entry seems possible. Do not use for general nutrition knowledge or workout advice.",
        inputSchema: HistoryInput.shape,
        outputSchema: HistoryOutput.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        // No outputTemplate on purpose: reads answer in text, they don't render
        // the editable card. The card is for logging/correcting, not for
        // "what's my total?" questions.
        _meta: {
          "openai/toolInvocation/invoking": "Checking your Nexus log…",
          "openai/toolInvocation/invoked": "Fetched from Nexus",
        },
      },
      async (args) => {
        const r = await safe(() => getHistory(this.env, this.user(), args));
        return r.ok ? this.dataResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_update_entry",
      {
        title: "Update a Nexus entry",
        description:
          "Use this when the user corrects or amends something already logged: fixing reps or weight, adding a set, changing meal items or macros, or adjusting a body-weight reading. Requires the entry id from nexus_get_history or a prior log result. The new data fully replaces the old entry.",
        inputSchema: UpdateInput.shape,
        outputSchema: UpdateOutput.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => updateEntry(this.env, this.user(), args));
        return r.ok ? this.dataResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_manage_friends",
      {
        title: "Manage Nexus friends",
        description:
          "Use this when the user wants to see their Nexus friends or friend code, add a friend by code (NEXUS-XXXX), or accept, reject, or remove a friend by email. Friends can view each other's fitness history via nexus_get_history with friend_id.",
        inputSchema: FriendsInput.shape,
        outputSchema: FriendsOutput.shape,
        // Not read-only (add/accept/remove mutate) and not open-world: it only
        // touches this app's own data, never a third-party service.
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => manageFriends(this.env, this.user(), args));
        return r.ok ? this.dataResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_set_goal",
      {
        title: "Set Nexus goal",
        description:
          "Use this only when the user explicitly asks to change a daily target — e.g. 'set my calorie goal to 2200' or 'bump my protein goal to 150'. Only pass the fields they're changing; unmentioned fields keep their current value. Defaults are 2100 kcal / 120g protein until a goal is ever set. Every call creates a new goal record — past goals are kept as history, not overwritten, so a future day's card can show whatever goal was actually in effect that day.",
        inputSchema: GoalInput.shape,
        outputSchema: GoalOutput.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => setGoal(this.env, this.user(), args));
        return r.ok ? this.dataResult(r.value) : errorResult(r.error);
      },
    );
  }
}
