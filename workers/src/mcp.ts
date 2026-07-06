import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

// Shared so the resource registration and the read callback agree — the MCP
// SDK does not merge registration _meta into read results.
const WIDGET_META = {
  "openai/widgetCSP": WIDGET_CSP,
  "openai/widgetPrefersBorder": true,
  "openai/widgetDescription":
    "Shows the day's logged workouts, meals, calories, and protein, updating live as new entries sync.",
};

const SERVER_INSTRUCTIONS = `Nexus is the user's personal workout, meal, and body-weight log.
Logging rules: call nexus_log_entries only when the user describes workout, meal, or body-weight data they already did or consumed and wants it saved. Estimate meal calories and macros before calling; Nexus stores the values you send and computes meal totals from item values. Reuse exercise_key values from your_exercises in nexus_get_history so progressions cluster (for example, use "bench_press" consistently).
Reading rules: use nexus_get_history for questions about the user's logged workouts, meals, calories, macros, weight, progress, or accepted friends' shared history. Check history before updating an entry and before logging when a duplicate seems likely.
Boundary rules: do not call Nexus for general fitness education, workout planning, nutrition advice, medical questions, sleep, mood, symptoms, or future intentions unless the user is also asking to log or retrieve supported Nexus data. Nexus stores and returns private tracking data; ChatGPT handles coaching, analysis, and conversation.`;

const LooseRecord = z.record(z.string(), z.unknown());
const EntrySummaryOutput = z.object({
  id: z.string(),
  entry_type: z.enum(["workout", "meal", "weight"]),
}).passthrough();

const PeriodOutput = z.object({
  from: z.string(),
  to: z.string(),
});

const DayTotalsOutput = z.object({
  exercises: z.number(),
  total_sets: z.number(),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  meals_logged: z.number(),
});

const HistoryOutput = z.object({
  period: PeriodOutput,
  workouts: z.array(LooseRecord),
  meals: z.array(LooseRecord),
  weights: z.array(LooseRecord),
  your_exercises: z.array(z.string()).optional(),
  pending_friend_requests: z.number().optional(),
  day_totals: DayTotalsOutput.optional(),
});

const LogOutput = HistoryOutput.extend({
  logged: z.array(EntrySummaryOutput),
});

const UpdateOutput = z.object({
  id: z.string(),
  entry_type: z.enum(["workout", "meal", "weight"]),
  updated: z.literal(true),
}).passthrough();

const FriendPartyOutput = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string(),
  friend_code: z.string().nullable(),
}).passthrough();

const FriendsOutput = z.union([
  z.object({
    your_code: z.string(),
    friends: z.array(FriendPartyOutput),
    pending_received: z.array(FriendPartyOutput),
    pending_sent: z.array(FriendPartyOutput),
  }),
  z.object({ status: z.string() }).passthrough(),
]);

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

  private textResult(payload: Record<string, unknown>) {
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
        mimeType: "text/html+skybridge",
        _meta: WIDGET_META,
      },
      async () => ({
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: "text/html+skybridge",
            text: widgetHtml(),
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
          "Log workout, meal, or body-weight entries the authenticated user already did or consumed. For meals, ChatGPT must provide item-level calorie and macro estimates; Nexus stores those values and computes totals. Do not use for advice, planning, future intentions, sleep, mood, symptoms, or general nutrition questions.",
        inputSchema: LogInput.shape,
        outputSchema: LogOutput,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "Logging to Nexus…",
          "openai/toolInvocation/invoked": "Logged to Nexus",
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
          "Retrieve the authenticated user's logged workouts, meals, body-weight entries, day totals, exercise keys, pending friend request count, or an accepted friend's shared history. Use before updates or possible duplicate logs. Do not use for general nutrition knowledge, workout planning, medical questions, or unsupported wellness tracking.",
        inputSchema: HistoryInput.shape,
        outputSchema: HistoryOutput,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: {
          "openai/outputTemplate": WIDGET_URI,
          "openai/toolInvocation/invoking": "Checking your Nexus log…",
          "openai/toolInvocation/invoked": "Fetched from Nexus",
        },
      },
      async (args) => {
        // The live subscription can only reproduce the viewer's own,
        // unfiltered day. Friend or type-filtered views stay static so the
        // live socket never overwrites the card with the wrong data.
        const live = !args.friend_id && !args.type;
        if (live) void this.widgetToken(); // warm the token alongside the read
        const r = await safe(() => getHistory(this.env, this.user(), args));
        return r.ok ? this.widgetResult(r.value, { live }) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "nexus_update_entry",
      {
        title: "Update a Nexus entry",
        description:
          "Replace one existing workout, meal, or body-weight entry owned by the authenticated user after the user asks to correct logged data. Requires the entry id from nexus_get_history or a prior log result. The submitted data fully replaces the previous entry data.",
        inputSchema: UpdateInput.shape,
        outputSchema: UpdateOutput,
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
          "List the user's Nexus friend code and friend requests, send a friend request by Nexus code, accept or reject a pending request by email, or remove a friend by email. Accepted friends can view each other's shared Nexus history through nexus_get_history with friend_id.",
        inputSchema: FriendsInput.shape,
        outputSchema: FriendsOutput,
        // Not read-only (add/accept/remove mutate) and not open-world: it only
        // touches this app's own data, never a third-party service.
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => manageFriends(this.env, this.user(), args));
        return r.ok ? this.textResult(r.value) : errorResult(r.error);
      },
    );
  }
}
