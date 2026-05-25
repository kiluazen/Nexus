import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NexusEnv, NexusProps } from "./types";
import { LogInput, HistoryInput, UpdateInput, FriendsInput } from "./schema/tool-inputs";
import { logEntries, getHistory, updateEntry } from "./data/entries";
import { manageFriends } from "./data/friends";
import { ValidationError } from "./lib/dates";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

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
  server = new McpServer({
    name: "Nexus – Workout and Nutrition Tracker",
    version: "3.0",
  });

  async init() {
    const user = () => ({
      userId: this.props!.userId,
      displayName: this.props!.displayName,
    });

    this.server.registerTool(
      "log_fitness_entries",
      {
        title: "Log fitness entries",
        description: "Store workout, meal, or body-weight entries for the authenticated Nexus user.",
        inputSchema: LogInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => logEntries(this.env, user(), args));
        return r.ok ? textResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "get_fitness_history",
      {
        title: "Get fitness history",
        description: "Fetch workouts, meals, body-weight entries, exercise keys, and friend-shared history for the authenticated Nexus user.",
        inputSchema: HistoryInput.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => getHistory(this.env, user(), args));
        return r.ok ? textResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "update_fitness_entry",
      {
        title: "Update fitness entry",
        description: "Replace one existing workout, meal, or body-weight entry owned by the authenticated Nexus user.",
        inputSchema: UpdateInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const r = await safe(() => updateEntry(this.env, user(), args));
        return r.ok ? textResult(r.value) : errorResult(r.error);
      },
    );

    this.server.registerTool(
      "manage_friend_connections",
      {
        title: "Manage friend connections",
        description: "List, add, accept, reject, or remove Nexus friend connections for shared fitness history.",
        inputSchema: FriendsInput.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      async (args) => {
        const r = await safe(() => manageFriends(this.env, user(), args));
        return r.ok ? textResult(r.value) : errorResult(r.error);
      },
    );
  }
}
