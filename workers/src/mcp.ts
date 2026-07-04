import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NexusEnv, NexusProps } from "./types";
import { LogInput, HistoryInput, UpdateInput, FriendsInput } from "./schema/tool-inputs";
import { logEntries, getHistory, updateEntry, type UserCtx } from "./data/entries";
import { manageFriends } from "./data/friends";
import { mintWidgetToken } from "./instant";
import { WIDGET_URI, widgetHtml } from "./widget/today-html";
import { ValidationError, todayUtc } from "./lib/dates";

// CSP for the widget iframe. connect_domains covers fetch + websocket for the
// live InstantDB session; unpkg serves the @instantdb/core UMD bundle. Both
// https and wss forms are declared — sandbox handling of wss is inconsistent,
// and the widget degrades to its static paint if the socket is blocked.
const WIDGET_CSP = {
  connect_domains: ["https://api.instantdb.com", "wss://api.instantdb.com"],
  resource_domains: ["https://unpkg.com"],
};

const SERVER_INSTRUCTIONS = `Nexus is the user's personal workout, meal, and body-weight log.
Logging rules: when the user mentions exercise they DID or food they ATE, call nexus_log_entries immediately — do not ask for confirmation. Estimate calories and macros yourself from the food description before calling; the server never guesses. Reuse exercise_key values from your_exercises in nexus_get_history so progressions cluster (e.g. always "bench_press", never "bench").
Reading rules: any question about past workouts, meals, calories, weight, or progress is nexus_get_history. Check history before logging when a duplicate seems likely.
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

  /** Tool result that also feeds the widget: structuredContent for the model
   *  and iframe, plus a hidden InstantDB token in _meta (widget-only — the
   *  model never sees _meta) so the card can go live. */
  private async widgetResult(payload: Record<string, unknown>) {
    let token: string | null = null;
    try {
      token = await mintWidgetToken(this.env, this.props!.email);
    } catch (e) {
      console.error("mintWidgetToken failed", e);
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      structuredContent: payload,
      _meta: token
        ? { "nexus/widget": { app_id: this.env.INSTANT_APP_ID, token } }
        : undefined,
    };
  }

  private textResult(payload: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  }

  async init() {
    this.server.registerResource(
      "nexus-today",
      WIDGET_URI,
      {
        title: "Nexus day card",
        description: "Live card showing the user's logged workouts, meals, and totals.",
        mimeType: "text/html+skybridge",
        _meta: {
          "openai/widgetCSP": WIDGET_CSP,
          "openai/widgetPrefersBorder": true,
          "openai/widgetDescription":
            "Shows the day's logged workouts, meals, calories, and protein, updating live as new entries sync.",
        },
      },
      async () => ({
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: "text/html+skybridge",
            text: widgetHtml(),
            _meta: {
              "openai/widgetCSP": WIDGET_CSP,
              "openai/widgetPrefersBorder": true,
            },
          },
        ],
      }),
    );

    this.server.registerTool(
      "nexus_log_entries",
      {
        title: "Log to Nexus",
        description:
          "Use this when the user mentions any workout, exercise, gym session, sport, run, or physical activity they did, any meal, food, snack, or drink they consumed, or a body-weight reading. Log it immediately without asking for confirmation; estimate macros from the description first. Do not use for advice, planning, future intentions, or nutrition questions.",
        inputSchema: LogInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "Logging to Nexus…",
          "openai/toolInvocation/invoked": "Logged to Nexus",
        },
      },
      async (args) => {
        const r = await safe(async () => {
          const logged = await logEntries(this.env, this.user(), args);
          // Return the whole day so the model has context and the widget has
          // a complete card even before the live session connects.
          const date = args.date ?? todayUtc();
          const day = await getHistory(this.env, this.user(), { date });
          return { ...logged, ...day };
        });
        return r.ok ? this.widgetResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_get_history",
      {
        title: "Get Nexus history",
        description:
          "Use this when the user asks what they ate, what workouts they did, their weight trend, calories, macros, protein, progress on an exercise, or wants a summary of any past day or date range. Also call it before logging when a duplicate entry seems possible. Do not use for general nutrition knowledge or workout advice.",
        inputSchema: HistoryInput.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "Checking your Nexus log…",
          "openai/toolInvocation/invoked": "Fetched from Nexus",
        },
      },
      async (args) => {
        const r = await safe(() => getHistory(this.env, this.user(), args));
        return r.ok ? this.widgetResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_update_entry",
      {
        title: "Update a Nexus entry",
        description:
          "Use this when the user corrects or amends something already logged: fixing reps or weight, adding a set, changing meal items or macros, or adjusting a body-weight reading. Requires the entry id from nexus_get_history or a prior log result. The new data fully replaces the old entry.",
        inputSchema: UpdateInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => updateEntry(this.env, this.user(), args));
        return r.ok ? this.textResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_manage_friends",
      {
        title: "Manage Nexus friends",
        description:
          "Use this when the user wants to see their Nexus friends or friend code, add a friend by code (NEXUS-XXXX), or accept, reject, or remove a friend by email. Friends can view each other's fitness history via nexus_get_history with friend_id.",
        inputSchema: FriendsInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      async (args) => {
        const r = await safe(() => manageFriends(this.env, this.user(), args));
        return r.ok ? this.textResult(r.value) : errorResult(r.error);
      },
    );
  }
}
