import type { NexusEnv } from "../types";
import { adminDb, rawQuery } from "../instant";
import { ValidationError } from "../lib/dates";
import type { UserCtx } from "./entries";

export type MutationReceipt = {
  id: string;
  tool: string;
  mutation_id: string;
  request_hash: string;
  result: Record<string, unknown>;
  created_at: number | string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function digestBytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function uuidFromBytes(bytes: Uint8Array): string {
  const b = bytes.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function deterministicMutationId(...parts: string[]): Promise<string> {
  return uuidFromBytes(await digestBytes(parts.join("\u001f")));
}

export async function requestHash(value: unknown): Promise<string> {
  return [...await digestBytes(stableJson(value))].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export type PreparedMutation = {
  receiptId: string;
  requestHash: string;
  replay?: Record<string, unknown>;
};

export async function prepareMutation(
  env: NexusEnv,
  user: UserCtx,
  tool: string,
  mutationId: string,
  request: unknown,
): Promise<PreparedMutation> {
  const receiptId = await deterministicMutationId("nexus-mutation", user.userId, tool, mutationId);
  const hash = await requestHash(request);
  const found = await rawQuery(adminDb(env), {
    mutationReceipts: {
      $: { where: { id: receiptId }, limit: 1 },
    },
  });
  const receipt = (found.mutationReceipts as MutationReceipt[])[0];
  if (!receipt) return { receiptId, requestHash: hash };
  if (receipt.request_hash !== hash) {
    throw new ValidationError(
      `mutation_id '${mutationId}' was already used with different arguments. Use a new mutation_id for a new action.`,
    );
  }
  return { receiptId, requestHash: hash, replay: receipt.result };
}

export function receiptChunk(
  env: NexusEnv,
  user: UserCtx,
  prepared: PreparedMutation,
  tool: string,
  mutationId: string,
  result: Record<string, unknown>,
) {
  const db = adminDb(env);
  return db.tx.mutationReceipts[prepared.receiptId]!
    .update({
      tool,
      mutation_id: mutationId,
      request_hash: prepared.requestHash,
      result,
      created_at: Date.now(),
    })
    .link({ owner: user.userId });
}
