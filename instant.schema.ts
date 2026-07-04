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
    }),

    // Friend graph. One row per relationship; status moves pending -> active.
    // Linked to both users via the links below.
    friendships: i.entity({
      status:     i.string().indexed(),            // "pending" | "active"
      created_at: i.date().indexed(),
    }),
  },

  links: {
    // entries.owner (one) <-> $users.entries (many)
    entryOwner: {
      forward: { on: 'entries', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'entries' },
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
  },
})

// TS helper boilerplate (InstantDB convention)
type _AppSchema = typeof _schema
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema
export type { AppSchema }
export default schema
