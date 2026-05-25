import { Client } from "pg";
import type { NexusEnv } from "../types";

export async function openClient(env: NexusEnv): Promise<Client> {
  const cs = env.NEXUS_DB.connectionString;
  console.log("db: new pg Client, host=", new URL(cs).host);
  // Hyperdrive terminates SSL with the origin; the Worker→Hyperdrive socket
  // is local plaintext. Explicitly disable client-side SSL so pg doesn't
  // try a STARTTLS handshake that the local socket won't answer.
  const client = new Client({ connectionString: cs, ssl: false });
  console.log("db: calling connect()");
  await client.connect();
  console.log("db: connected");
  return client;
}

/**
 * Convenience for one-shot queries: opens a connection, runs the callback,
 * always closes the connection (in `ctx.waitUntil` if available so it doesn't
 * delay the response).
 */
export async function withClient<T>(
  env: NexusEnv,
  fn: (c: Client) => Promise<T>,
  ctx?: ExecutionContext,
): Promise<T> {
  const c = await openClient(env);
  try {
    return await fn(c);
  } finally {
    if (ctx) ctx.waitUntil(c.end());
    else await c.end();
  }
}
