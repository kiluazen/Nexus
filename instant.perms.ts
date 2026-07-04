// Nexus permission rules. Deny by default; a signed-in user touches only rows
// linked to them. The Worker uses adminDb.asUser(...) so these rules are the
// real enforcement layer for every MCP tool call and widget query.
//
// Friend reads of entries intentionally do NOT happen through these rules yet:
// the server does friendship-checked reads via the admin client, and the
// widget only ever reads the viewer's own data.
import type { InstantRules } from '@instantdb/core'

const rules = {
  $default: { allow: { $default: 'false' } },

  $users: {
    allow: {
      view: 'auth.id == data.id',
    },
  },

  entries: {
    bind: ['isOwner', "auth.id != null && auth.id in data.ref('owner.id')"],
    allow: {
      view: 'isOwner',
      create: 'isOwner',
      update: 'isOwner',
      delete: 'isOwner',
    },
  },

  friendships: {
    bind: [
      'isParty',
      "auth.id != null && (auth.id in data.ref('requester.id') || auth.id in data.ref('addressee.id'))",
    ],
    allow: {
      view: 'isParty',
      create: "auth.id != null && auth.id in data.ref('requester.id')",
      update: 'isParty',
      delete: 'isParty',
    },
  },
} satisfies InstantRules

export default rules
