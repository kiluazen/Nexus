# ChatGPT MCP App — Tool Justifications

Copy-paste these into the submission form fields. They mirror the annotations
declared in `workers/src/mcp.ts` exactly — reviewers reject apps whose stated
hints don't match tool behavior, so keep the two in sync.

Annotation legend: **Read Only** = `readOnlyHint`, **Destructive** =
`destructiveHint`, **Open World** = `openWorldHint`. "Open world" means the tool
reaches a service *outside* this app (email, third-party API). Every Nexus tool
touches only the user's own data in Nexus's InstantDB, so open world is No for
all of them.

---

## `nexus_log_entries`

**Read Only: No** — inserts new workout, meal, and body-weight rows.

**Destructive: No** — it only appends new rows; it never overwrites or deletes
existing entries. Corrections go through `nexus_update_entry`.

**Open World: No** — writes solely to the authenticated user's own data in the
app database; no third-party service is contacted.

---

## `nexus_get_history`

**Read Only: Yes** — returns the user's logged entries, totals, and exercise
keys. First use lazily assigns a friend code, but that is a one-time
idempotent backfill, not a user-visible mutation, so the tool reads as
read-only to the model.

**Destructive: No** — reads data.

**Open World: No** — queries only the authenticated user's own data (or a
friend's, gated by an accepted friendship); no external service.

---

## `nexus_update_entry`

**Read Only: No** — replaces the data of one existing entry.

**Destructive: Yes** — a full replacement overwrites the prior version of that
entry, which cannot be recovered.

**Open World: No** — modifies only the authenticated user's own row.

---

## `nexus_manage_friends`

**Read Only: No** — `add` creates a request, `accept` updates status,
`reject`/`remove` delete rows. (`list` reads, but the tool as a whole mutates.)

**Destructive: Yes** — `remove` and `reject` permanently delete friendship
records; removing a friend revokes their view of the user's history.

**Open World: No** — operates only on this app's own friendship and user rows.
Friend codes and emails address other Nexus accounts, not an external service.
