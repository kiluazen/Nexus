import { describe, expect, it } from "vitest";
import { handleProtectedResource } from "../src/handlers/protected-resource";
import { computeMealTotals, parseEntry, parseEntryInput, entryInputToStorage } from "../src/schema/entry-shapes";
import { parseDate, ValidationError } from "../src/lib/dates";
import { widgetHtml } from "../src/widget/today-html";
import type { NexusEnv } from "../src/types";

const env = { BASE_URL: "https://mcp.nexus.kushalsm.com" } as NexusEnv;

describe("submission metadata", () => {
  it("serves path-suffixed protected-resource metadata with the canonical no-slash MCP resource", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource/mcp/",
    ]) {
      const response = handleProtectedResource(new Request(`https://mcp.nexus.kushalsm.com${path}`), env);
      expect(response?.status).toBe(200);
      const body = await response!.json() as { resource: string };
      expect(body.resource).toBe("https://mcp.nexus.kushalsm.com/mcp");
    }
  });

  it("keeps meal totals server-computed and validates exercise keys", () => {
    expect(computeMealTotals([
      { calories: 120.04, protein_g: 5.04, carbs_g: 20.04, fat_g: 2.04 },
      { calories: 80.04, protein_g: 3.04, carbs_g: 10.04, fat_g: 1.04 },
    ])).toEqual({ calories: 200.1, protein_g: 8.1, carbs_g: 30.1, fat_g: 3.1 });

    expect(() => parseEntry({
      type: "workout",
      exercise: "Bench Press",
      exercise_key: "Bench Press",
      sets: [{ weight_kg: 60, reps: 8 }],
    })).toThrow(/exercise_key/);
  });

  it("widget inline script parses (tsc can't see inside the template string)", () => {
    const html = widgetHtml();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script && script.length).toBeTruthy();
    // new Function only PARSES the body; a syntax error (e.g. an unterminated
    // string) throws here, undefined runtime globals (window, instant) do not.
    expect(() => new Function(script as string)).not.toThrow();
  });

  it("accepts a flat meal, defaults missing macros, and maps to storage", () => {
    // The shape the model naturally sends — flat, no nested items[].
    const entry = parseEntryInput({ type: "meal", name: "Cappuccino", calories: 120, protein_g: 6 });
    const s = entryInputToStorage(entry);
    expect(s.type).toBe("meal");
    expect(s.data.totals).toEqual({ calories: 120, protein_g: 6, carbs_g: 0, fat_g: 0 });
    expect((s.data.items as { name: string; quantity: number }[])[0]).toMatchObject({ name: "Cappuccino", quantity: 1 });
  });

  it("strips unknown keys but still rejects a wrong discriminator", () => {
    // Extra keys the model might add are ignored, not rejected.
    const s = entryInputToStorage(parseEntryInput({ type: "meal", name: "Kiwi", calories: 42, description: "green", quantity: 1 }));
    expect(s.data.totals).toMatchObject({ calories: 42 });
    // But a bad discriminator is a clear error (no silent fallback).
    expect(() => parseEntryInput({ kind: "meal", name: "x", calories: 1 })).toThrow();
  });

  it("rejects calendar dates that V8 would silently roll over", () => {
    expect(parseDate("2026-07-04")).toBe("2026-07-04");
    // 2026 is not a leap year; Feb 30 / Apr 31 roll forward in V8.
    expect(() => parseDate("2026-02-30")).toThrow(ValidationError);
    expect(() => parseDate("2026-04-31")).toThrow(ValidationError);
    expect(() => parseDate("2026-02-29")).toThrow(ValidationError);
  });
});
