# ChatGPT MCP App — Tool Justifications

Copy-paste these into the form fields.

---

## `log`

**Read Only: No**
This tool inserts new rows into the database (workout exercises and meal entries). It writes data, so it is not read-only.

**Open World: Yes**
The tool accepts free-form exercise names, exercise keys, and meal item descriptions from the user. It processes arbitrary real-world food and exercise data that the model identifies, so it interacts with the open world of possible inputs.

**Destructive: Yes**
Inserting entries modifies the user's data permanently. While individual inserts can be corrected via the update tool, a duplicate or incorrect entry changes the user's logged history and daily macro totals.

---

## `history`

**Read Only: No**
While history primarily reads data, it also computes and returns derived values (day_totals, pending friend request counts) and triggers a friend code generation on first use if one doesn't exist. It is not purely read-only due to these side effects.

**Open World: Yes**
The tool queries user data that includes free-form exercise names, meal items, and notes entered by the user over time. The response content reflects open-world data.

**Destructive: Yes**
The tool can trigger friend code generation as a side effect on first use, which writes to the users table. This is a minor write but technically modifies server state.

---

## `update`

*(Not shown in screenshot but likely also needed)*

**Read Only: No**
This tool replaces the data of an existing database entry. It performs an UPDATE query, modifying stored workout sets, meal items, or exercise details.

**Open World: Yes**
The replacement data contains free-form exercise names, meal items, and macro estimates from the user. The tool processes arbitrary real-world fitness and nutrition data.

**Destructive: Yes**
The tool performs a full replacement of an entry's data. The previous version of the data is overwritten and cannot be recovered. Incorrect updates could lose the user's original logged information.

---

## `friends`

*(Not shown in screenshot but likely also needed)*

**Read Only: No**
This tool creates, updates, and deletes friendship records in the database. The "add" action inserts rows, "accept" updates status, and "reject"/"remove" delete rows.

**Open World: Yes**
The tool interacts with other users via friend codes and display names. It operates across the user base, not just the authenticated user's own data.

**Destructive: Yes**
The "remove" and "reject" actions permanently delete friendship records from the database. Removing a friend revokes their ability to view the user's workout and meal history.
