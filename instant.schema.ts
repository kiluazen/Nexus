// Nexus on InstantDB — canonical schema. Push with `npx instant-cli@latest push schema`.
// Mirrors the old Postgres model (entries + friends) but owner-linked through
// InstantDB's managed `$users`, so auth and data share one identity.
import { i } from '@instantdb/core'

const _schema = i.schema({
  entities: {
    // Managed by InstantDB. `email` is set by the magic-code (OTP) flow on first
    // sign-in — this is the single identity every surface (Codex, Claude Code,
    // ChatGPT) authenticates into. `friend_code` is our shareable handle.
    $users: i.entity({
      email: i.string().unique().indexed(),
      friend_code: i.string().unique().indexed().optional(), // "NEXUS-R3M8"
      created_at: i.date().indexed().optional(),
    }),

    // Email+password credential, deliberately kept OUT of $users: a signed-in
    // client (the ChatGPT widget, the CLI) holds a real InstantDB token for its
    // own $users row, and $users is client-readable — so a password hash there
    // would be reachable by that token and crackable offline. This namespace is
    // denied to every client in instant.perms.ts; only the Worker's admin
    // client (which bypasses perms) ever reads or writes it.
    passwordCredentials: i.entity({
      hash:       i.string(),                       // pbkdf2$iters$salt$hash
      updated_at: i.date().indexed().optional(),
    }),

    // One workout / meal / body-weight row. Scalar fields are indexed for
    // history queries; the shape-specific payload (sets, items+macros, weight)
    // lives in `data` as JSON so we keep the old flexible entry contract.
    entries: i.entity({
      type:         i.string().indexed(),          // "workout" | "meal" | "weight"
      entry_date:   i.date().indexed(),            // the day this is logged against
      exercise_key: i.string().indexed().optional(),// normalized, for workout clustering
      meal_type:    i.string().optional(),         // "breakfast" | "lunch" | ...
      data:         i.json(),                       // sets[] | items[] | { weight_kg }
      created_at:   i.date().indexed(),
      updated_at:   i.date().indexed(),
      // Opaque optimistic-concurrency token. It changes on every accepted
      // mutation and is returned to every host as `state_version`.
      version:      i.string().optional(),
    }),

    // Durable retry receipts shared by every Nexus surface. The row id is a
    // deterministic UUID derived from owner + tool + mutation_id; therefore
    // an exact retry addresses the same receipt even across hosts/sessions.
    mutationReceipts: i.entity({
      tool:         i.string().indexed(),
      mutation_id:  i.string().indexed(),
      request_hash: i.string(),
      result:       i.json(),
      created_at:   i.date().indexed(),
    }),

    // Friend graph. One row per relationship; status moves pending -> active.
    // Linked to both users via the links below.
    friendships: i.entity({
      status:     i.string().indexed(),            // "pending" | "active"
      created_at: i.date().indexed(),
    }),

    // Calorie/protein/carb/fat targets. Append-only, never overwritten in
    // place: changing a goal inserts a new row rather than mutating an
    // existing one, so "current goal" is just "the latest row" and history
    // is free — it's every row that came before. This is what lets a future
    // history view show the goal that was actually in effect on a past date,
    // not whatever it happens to be today.
    goals: i.entity({
      calorie_goal: i.number(),
      protein_goal: i.number(),
      carbs_goal:   i.number().optional(),
      fat_goal:     i.number().optional(),
      reason:       i.string().optional(),          // "cutting for summer", optional context
      created_at:   i.date().indexed(),
    }),

    // Per-user exercise catalogue, one row per distinct exercise_key. Rows
    // accrete: the first time a user logs a new key, the model supplies the
    // metadata (it knows an incline dumbbell press is a chest movement) and
    // the Worker upserts the row — no built-in seed list needed. This is what
    // makes history analyzable: bench_press_barbell vs bench_press_dumbbell
    // vs incline_bench_press_dumbbell are distinct catalogued things, each
    // carrying muscle / movement pattern / equipment.
    exercises: i.entity({
      key:           i.string().indexed(),          // "bench_press_barbell" — unique per owner
      name:          i.string(),                    // "Bench Press - Barbell"
      muscle:        i.string().optional(),         // "Chest"
      pattern:       i.string().optional(),         // "Bench Press" (movement family)
      equipment:     i.string().optional(),         // "Barbell" | "Dumbbell" | "Machine" | ...
      is_bodyweight: i.boolean().optional(),
      created_at:    i.date().indexed(),
      updated_at:    i.date().indexed().optional(),
    }),
  },

  links: {
    // entries.owner (one) <-> $users.entries (many)
    entryOwner: {
      forward: { on: 'entries', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'entries' },
    },
    // passwordCredentials.user (one) <-> $users.passwordCredential (one)
    userPassword: {
      forward: { on: 'passwordCredentials', has: 'one', label: 'user' },
      reverse: { on: '$users', has: 'one', label: 'passwordCredential' },
    },
    // friendships.requester (one) <-> $users.sentFriendships (many)
    friendshipRequester: {
      forward: { on: 'friendships', has: 'one', label: 'requester' },
      reverse: { on: '$users', has: 'many', label: 'sentFriendships' },
    },
    // friendships.addressee (one) <-> $users.receivedFriendships (many)
    friendshipAddressee: {
      forward: { on: 'friendships', has: 'one', label: 'addressee' },
      reverse: { on: '$users', has: 'many', label: 'receivedFriendships' },
    },
    // goals.owner (one) <-> $users.goals (many)
    goalOwner: {
      forward: { on: 'goals', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'goals' },
    },
    // exercises.owner (one) <-> $users.exercises (many)
    exerciseOwner: {
      forward: { on: 'exercises', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'exercises' },
    },
    mutationReceiptOwner: {
      forward: { on: 'mutationReceipts', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'mutationReceipts' },
    },
  },
})

// TS helper boilerplate (InstantDB convention)
type _AppSchema = typeof _schema
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema
export type { AppSchema }
export default schema
