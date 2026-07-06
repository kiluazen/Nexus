import { describe, expect, it } from "vitest";
import { handleProtectedResource } from "../src/handlers/protected-resource";
import { computeMealTotals, parseEntry, parseEntryInput, entryInputToStorage } from "../src/schema/entry-shapes";
import { parseDate, ValidationError } from "../src/lib/dates";
import { DEFAULT_GOAL, mergeGoalUpdate } from "../src/schema/goal-shapes";
import { widgetHtml } from "../src/widget/today-html";
import { consentHtml } from "../src/auth/consent-html";
import { hashPassword, verifyPassword } from "../src/auth/password";
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

  it("consent page inline script parses, with and without the Google button", () => {
    for (const googleEnabled of [true, false]) {
      const html = consentHtml({ nonce: "n-1", clientName: "ChatGPT", googleEnabled });
      const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
      expect(script && script.length).toBeTruthy();
      expect(() => new Function(script as string)).not.toThrow();
      // The Google button only exists when configured.
      expect(html.includes('id="google"')).toBe(googleEnabled);
    }
  });

  it("hashes a password and verifies it (PBKDF2 round-trip, wrong password fails)", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    // A second hash of the same password uses a fresh salt, so it differs.
    const hash2 = await hashPassword("correct horse battery");
    expect(hash2).not.toBe(hash);
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

  it("a first-ever goal update fills in defaults for anything unmentioned", () => {
    // No current row (user's never set a goal) — "just bump protein" still
    // has to produce a complete row, not a patch with calories missing.
    expect(mergeGoalUpdate(null, { protein_g: 150 })).toEqual({
      calories: DEFAULT_GOAL.calories, // 2100, untouched
      protein_g: 150,
      carbs_g: undefined,
      fat_g: undefined,
    });
  });

  it("a later goal update carries forward fields the caller didn't mention", () => {
    const current = { calories: 2200, protein_g: 140, carbs_g: 200, fat_g: 60 };
    expect(mergeGoalUpdate(current, { calories: 1900 })).toEqual({
      calories: 1900,
      protein_g: 140, // carried over, not reset to the default
      carbs_g: 200,
      fat_g: 60,
    });
  });

  it("an empty update is a no-op copy of the current goal", () => {
    const current = { calories: 2200, protein_g: 140 };
    expect(mergeGoalUpdate(current, {})).toEqual(current);
  });
});
