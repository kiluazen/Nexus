import type { NexusEnv } from "../types";
import { withClient } from "./db";
import { ValidationError } from "../lib/dates";

interface UserCtx {
  userId: string;
  displayName: string;
}

export async function manageFriends(
  env: NexusEnv,
  user: UserCtx,
  args: { action: string; code?: string; display_name?: string },
): Promise<Record<string, unknown>> {
  return withClient(env, async (c) => {
    await c.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [user.userId, user.displayName],
    );

    switch (args.action) {
      case "list":   return list(c, user.userId);
      case "add": {
        if (!args.code) throw new ValidationError("code is required for 'add'.");
        return add(c, user.userId, args.code.trim().toUpperCase());
      }
      case "accept":
      case "reject": {
        if (!args.display_name) throw new ValidationError(`display_name is required for '${args.action}'.`);
        return acceptOrReject(c, user.userId, args.display_name.trim(), args.action === "accept");
      }
      case "remove": {
        if (!args.display_name) throw new ValidationError("display_name is required for 'remove'.");
        return remove(c, user.userId, args.display_name.trim());
      }
      default:
        throw new ValidationError(`Unknown action: ${JSON.stringify(args.action)}. Use list/add/accept/reject/remove.`);
    }
  });
}

async function ensureFriendCode(c: import("pg").Client, userId: string): Promise<string> {
  const existing = await c.query<{ friend_code: string | null }>(
    `SELECT friend_code FROM users WHERE id = $1`,
    [userId],
  );
  const current = existing.rows[0]?.friend_code ?? null;
  if (current) return current;

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = `NEXUS-${suffix}`;
    const clash = await c.query(`SELECT 1 FROM users WHERE friend_code = $1 LIMIT 1`, [code]);
    if (clash.rows.length === 0) {
      await c.query(`UPDATE users SET friend_code = $1 WHERE id = $2`, [code, userId]);
      return code;
    }
  }
  throw new ValidationError("Failed to generate unique friend code.");
}

async function list(c: import("pg").Client, userId: string): Promise<Record<string, unknown>> {
  const myCode = await ensureFriendCode(c, userId);

  const friends = await c.query<{ id: string; display_name: string; since: string }>(
    `SELECT u.id, u.display_name, f.created_at::date::text AS since
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.recipient_id ELSE f.requester_id END
     WHERE (f.requester_id = $1 OR f.recipient_id = $1) AND f.status = 'active'
     ORDER BY u.display_name`,
    [userId],
  );
  const pendingReceived = await c.query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name FROM friendships f
     JOIN users u ON u.id = f.requester_id
     WHERE f.recipient_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId],
  );
  const pendingSent = await c.query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name FROM friendships f
     JOIN users u ON u.id = f.recipient_id
     WHERE f.requester_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId],
  );

  return {
    your_code: myCode,
    friends: friends.rows.map((r) => ({ user_id: r.id, display_name: r.display_name, since: r.since })),
    pending_received: pendingReceived.rows.map((r) => ({ user_id: r.id, display_name: r.display_name })),
    pending_sent:     pendingSent.rows.map((r) => ({ user_id: r.id, display_name: r.display_name })),
  };
}

async function add(c: import("pg").Client, userId: string, code: string): Promise<Record<string, unknown>> {
  const target = await c.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users WHERE friend_code = $1 LIMIT 1`,
    [code],
  );
  if (target.rows.length === 0) throw new ValidationError(`No user found with code ${code}`);
  const t = target.rows[0]!;
  if (t.id === userId) throw new ValidationError("You can't add yourself.");

  const existing = await c.query<{ status: string }>(
    `SELECT status FROM friendships
     WHERE (requester_id = $1 AND recipient_id = $2)
        OR (requester_id = $2 AND recipient_id = $1)
     LIMIT 1`,
    [userId, t.id],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0]!.status === "active"
      ? { status: "already_friends", with: t.display_name }
      : { status: "already_pending", with: t.display_name };
  }

  await c.query(
    `INSERT INTO friendships (requester_id, recipient_id, status) VALUES ($1, $2, 'pending')`,
    [userId, t.id],
  );
  return { status: "request_sent", to: t.display_name };
}

async function acceptOrReject(
  c: import("pg").Client,
  userId: string,
  displayName: string,
  accept: boolean,
): Promise<Record<string, unknown>> {
  const row = await c.query<{ id: number; display_name: string }>(
    `SELECT f.id, u.display_name FROM friendships f
     JOIN users u ON u.id = f.requester_id
     WHERE f.recipient_id = $1 AND f.status = 'pending' AND u.display_name = $2
     LIMIT 1`,
    [userId, displayName],
  );
  if (row.rows.length === 0) throw new ValidationError(`No pending request from '${displayName}'.`);
  const id = row.rows[0]!.id;
  const name = row.rows[0]!.display_name;
  if (accept) {
    await c.query(`UPDATE friendships SET status = 'active' WHERE id = $1`, [id]);
    return { status: "accepted", friend: name };
  }
  await c.query(`DELETE FROM friendships WHERE id = $1`, [id]);
  return { status: "rejected", name };
}

async function remove(c: import("pg").Client, userId: string, displayName: string): Promise<Record<string, unknown>> {
  const deleted = await c.query(
    `DELETE FROM friendships WHERE id IN (
       SELECT f.id FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.recipient_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.recipient_id = $1) AND u.display_name = $2
     ) RETURNING id`,
    [userId, displayName],
  );
  if (deleted.rowCount === 0) throw new ValidationError(`No friend named '${displayName}' found.`);
  return { status: "removed", name: displayName };
}
