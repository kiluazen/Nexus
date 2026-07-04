import type { NexusEnv } from "../types";
import { adminDb, ensureFriendCode, displayNameFromEmail, rawQuery, id as newId } from "../instant";
import type { UserCtx } from "./entries";
import { ValidationError } from "../lib/dates";

type PartyRow = { id: string; email?: string; friend_code?: string };
type FriendshipRow = {
  id: string;
  status: string;
  created_at: number | string;
  requester?: PartyRow;
  addressee?: PartyRow;
};

function party(p: PartyRow | undefined) {
  const email = p?.email ?? "";
  return {
    user_id: p?.id ?? "",
    email,
    display_name: displayNameFromEmail(email),
    friend_code: p?.friend_code ?? null,
  };
}

export async function manageFriends(
  env: NexusEnv,
  user: UserCtx,
  args: { action: string; code?: string; email?: string },
): Promise<Record<string, unknown>> {
  const db = adminDb(env);

  switch (args.action) {
    case "list":
      return list(db, user);
    case "add": {
      if (!args.code) throw new ValidationError("code is required for 'add'.");
      return add(db, user, args.code.trim().toUpperCase());
    }
    case "accept":
    case "reject": {
      if (!args.email) throw new ValidationError(`email is required for '${args.action}'.`);
      return acceptOrReject(db, user, args.email.trim().toLowerCase(), args.action === "accept");
    }
    case "remove": {
      if (!args.email) throw new ValidationError("email is required for 'remove'.");
      return remove(db, user, args.email.trim().toLowerCase());
    }
    default:
      throw new ValidationError(
        `Unknown action: ${JSON.stringify(args.action)}. Use list/add/accept/reject/remove.`,
      );
  }
}

async function myFriendships(db: ReturnType<typeof adminDb>, userId: string) {
  const res = await rawQuery(db, {
    friendships: {
      $: {
        where: { or: [{ "requester.id": userId }, { "addressee.id": userId }] },
        order: { created_at: "desc" },
      },
      requester: {},
      addressee: {},
    },
  });
  return res.friendships as unknown as FriendshipRow[];
}

async function list(db: ReturnType<typeof adminDb>, user: UserCtx) {
  const myCode = await ensureFriendCode(db, user.userId);
  const rows = await myFriendships(db, user.userId);

  const friends: Record<string, unknown>[] = [];
  const pendingReceived: Record<string, unknown>[] = [];
  const pendingSent: Record<string, unknown>[] = [];

  for (const f of rows) {
    const iAmRequester = f.requester?.id === user.userId;
    const other = party(iAmRequester ? f.addressee : f.requester);
    if (f.status === "active") {
      friends.push({ ...other, since: new Date(f.created_at).toISOString().slice(0, 10) });
    } else if (f.status === "pending" && !iAmRequester) {
      pendingReceived.push(other);
    } else if (f.status === "pending" && iAmRequester) {
      pendingSent.push(other);
    }
  }

  friends.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  return { your_code: myCode, friends, pending_received: pendingReceived, pending_sent: pendingSent };
}

async function add(db: ReturnType<typeof adminDb>, user: UserCtx, code: string) {
  const target = await db.query({ $users: { $: { where: { friend_code: code } } } });
  const t = target.$users[0];
  if (!t) throw new ValidationError(`No user found with code ${code}`);
  if (t.id === user.userId) throw new ValidationError("You can't add yourself.");

  const existing = await rawQuery(db, {
    friendships: {
      $: {
        where: {
          or: [
            { and: [{ "requester.id": user.userId }, { "addressee.id": t.id }] },
            { and: [{ "requester.id": t.id }, { "addressee.id": user.userId }] },
          ],
        },
      },
    },
  });
  const found = existing.friendships[0] as FriendshipRow | undefined;
  const otherName = displayNameFromEmail(t.email ?? "");
  if (found) {
    return found.status === "active"
      ? { status: "already_friends", with: otherName }
      : { status: "already_pending", with: otherName };
  }

  await db.transact([
    db.tx.friendships[newId()]!
      .update({ status: "pending", created_at: Date.now() })
      .link({ requester: user.userId, addressee: t.id }),
  ]);
  return { status: "request_sent", to: otherName };
}

async function acceptOrReject(
  db: ReturnType<typeof adminDb>,
  user: UserCtx,
  email: string,
  accept: boolean,
) {
  const res = await rawQuery(db, {
    friendships: {
      $: {
        where: {
          and: [
            { "addressee.id": user.userId },
            { status: "pending" },
            { "requester.email": email },
          ],
        },
      },
      requester: {},
    },
  });
  const f = res.friendships[0] as FriendshipRow | undefined;
  if (!f) throw new ValidationError(`No pending request from '${email}'.`);
  const name = displayNameFromEmail(f.requester?.email ?? email);

  if (accept) {
    await db.transact([db.tx.friendships[f.id]!.update({ status: "active" })]);
    return { status: "accepted", friend: name };
  }
  await db.transact([db.tx.friendships[f.id]!.delete()]);
  return { status: "rejected", name };
}

async function remove(db: ReturnType<typeof adminDb>, user: UserCtx, email: string) {
  const res = await rawQuery(db, {
    friendships: {
      $: {
        where: {
          or: [
            { and: [{ "requester.id": user.userId }, { "addressee.email": email }] },
            { and: [{ "addressee.id": user.userId }, { "requester.email": email }] },
          ],
        },
      },
    },
  });
  const rows = res.friendships as unknown as FriendshipRow[];
  if (rows.length === 0) throw new ValidationError(`No friend with email '${email}' found.`);
  await db.transact(rows.map((f) => db.tx.friendships[f.id]!.delete()));
  return { status: "removed", email };
}
