import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { widgetHtml } from "../src/widget/today-html";

type Listener = (event: any) => void;

function browserScript(): string {
  const scripts = [...widgetHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.map((match) => match[1]!).find((source) => source.includes("var GOAL_KCAL"));
  if (!script) throw new Error("widget application script not found");
  return script;
}

function workoutSnapshot() {
  return {
    period: { from: "2026-07-13", to: "2026-07-13" },
    logged: [{ id: "workout-1", entry_type: "workout" }],
    workouts: [{
      id: "workout-1",
      date: "2026-07-13",
      exercise: "Flat Bench Press",
      exercise_key: "flat-bench-press",
      sets: [{ weight_kg: 25, reps: 5 }],
    }],
    meals: [],
    weights: [],
  };
}

async function mountWidget() {
  const rootListeners: Record<string, Listener> = {};
  const windowListeners: Record<string, Listener[]> = {};
  let subscription: Listener | null = null;
  const root = {
    innerHTML: "",
    addEventListener(type: string, listener: Listener) {
      rootListeners[type] = listener;
    },
  };
  const initialOutput = workoutSnapshot();
  let toolResultHandler: Listener | null = null;
  const bridge = {
    connect(handler: Listener) {
      toolResultHandler = handler;
      handler({
        structuredContent: initialOutput,
        _meta: { "nexus/widget": { app_id: "test-app", token: "test-token" } },
      });
      return Promise.resolve();
    },
    callTool: async () => ({}),
  };
  const windowObject: any = {
    NexusMcpBridge: bridge,
    addEventListener(type: string, listener: Listener) {
      (windowListeners[type] ||= []).push(listener);
    },
  };
  const context = {
    window: windowObject,
    document: {
      activeElement: null,
      getElementById(id: string) {
        return id === "nexus-root" ? root : null;
      },
    },
    instant: {
      init() {
        return {
          auth: { signInWithToken: async () => undefined },
          subscribeQuery(_query: unknown, listener: Listener) {
            subscription = listener;
          },
        };
      },
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    Object,
    Promise,
    String,
    Number,
    Array,
    parseFloat,
    isFinite,
  };

  vm.runInNewContext(browserScript(), context);
  await Promise.resolve();
  await Promise.resolve();

  return {
    root,
    emitToolResult(result: any) {
      if (!toolResultHandler) throw new Error("tool-result handler not registered");
      toolResultHandler(result);
    },
    emitWindow(type: string, event: any) {
      for (const listener of windowListeners[type] || []) listener(event);
    },
    clickView(view: "food" | "workout") {
      const listener = rootListeners.click;
      if (!listener) throw new Error("root click listener not registered");
      listener({
        target: {
          closest(selector: string) {
            return selector === "[data-view]"
              ? { getAttribute: () => view }
              : null;
          },
        },
      });
    },
    pushLiveEntries(entries: any[]) {
      if (!subscription) throw new Error("live subscription not started");
      subscription({ data: { entries } });
    },
  };
}

describe("widget host lifecycle", () => {
  it("does not reset the selected view or clobber live data on repeated tool delivery", async () => {
    const widget = await mountWidget();
    const entryDate = Date.parse("2026-07-13T00:00:00Z");

    widget.pushLiveEntries([
      {
        id: "workout-1",
        type: "workout",
        entry_date: entryDate,
        data: {
          exercise: "Flat Bench Press",
          exercise_key: "flat-bench-press",
          sets: [{ weight_kg: 25, reps: 5 }],
        },
      },
      {
        id: "meal-live",
        type: "meal",
        entry_date: entryDate,
        data: {
          meal_type: "snack",
          description: "Fresh live meal",
          items: [{ name: "Fresh live meal", calories: 220, protein_g: 12 }],
          totals: { calories: 220, protein_g: 12, carbs_g: 18, fat_g: 7 },
        },
      },
    ]);
    widget.clickView("food");

    expect(widget.root.innerHTML).toContain("Fresh live meal");
    expect(widget.root.innerHTML).toContain('data-view="food" aria-label="Food" title="Food" class="on"');

    widget.emitToolResult({
      structuredContent: JSON.parse(JSON.stringify(workoutSnapshot())),
      _meta: { "nexus/widget": { app_id: "test-app", token: "test-token" } },
    });

    expect(widget.root.innerHTML).toContain("Fresh live meal");
    expect(widget.root.innerHTML).toContain('data-view="food" aria-label="Food" title="Food" class="on"');
  });

  it("deduplicates an equivalent standard MCP Apps tool result", async () => {
    const widget = await mountWidget();
    const entryDate = Date.parse("2026-07-13T00:00:00Z");
    widget.pushLiveEntries([
      {
        id: "workout-1",
        type: "workout",
        entry_date: entryDate,
        data: {
          exercise: "Flat Bench Press",
          exercise_key: "flat-bench-press",
          sets: [{ weight_kg: 25, reps: 5 }],
        },
      },
      {
        id: "meal-live",
        type: "meal",
        entry_date: entryDate,
        data: {
          meal_type: "snack",
          description: "Fresh live meal",
          items: [{ name: "Fresh live meal", calories: 220, protein_g: 12 }],
          totals: { calories: 220, protein_g: 12, carbs_g: 18, fat_g: 7 },
        },
      },
    ]);
    widget.clickView("food");

    widget.emitToolResult({
      structuredContent: JSON.parse(JSON.stringify(workoutSnapshot())),
      _meta: { "nexus/widget": { app_id: "test-app", token: "test-token" } },
    });

    expect(widget.root.innerHTML).toContain("Fresh live meal");
    expect(widget.root.innerHTML).toContain('data-view="food" aria-label="Food" title="Food" class="on"');
  });
});
