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

  // These rules are the real enforcement boundary: a user's bearer is their
  // InstantDB identity, so they could transact directly against InstantDB
  // outside our server. The threat is self-granting an 'active' friendship to
  // read a victim's history. All legitimate friend management goes through
  // manageFriends(), which runs as admin and bypasses these rules, so we deny
  // direct friendship writes almost entirely: a self-activated friendship
  // fails the create rule (status must be pending) and the update rule (only
  // the addressee may act on a pending request — no self-approval).
  friendships: {
    bind: [
      'isRequester',
      "auth.id != null && auth.id in data.ref('requester.id')",
      'isAddressee',
      "auth.id != null && auth.id in data.ref('addressee.id')",
    ],
    allow: {
      view: 'isRequester || isAddressee',
      create: "isRequester && data.status == 'pending'",
      update: "isAddressee && data.status == 'pending'",
      delete: 'isRequester || isAddressee',
    },
  },
} satisfies InstantRules

export default rules
