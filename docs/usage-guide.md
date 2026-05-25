# Nexus — Usage Guide

Nexus is a remote MCP server. Connect it to Claude, ChatGPT, Codex, or any
other MCP-aware client; once authorized you get four tools that let the
client log and read your fitness entries.

This guide walks through the five things you'll actually do.

## Setup

In your MCP client, add a custom connector at:

```
https://mcp.nexus.kushalsm.com/mcp
```

Sign in with Google or email/password. The first time you do this, Nexus
provisions your account automatically — no signup form. After auth, the
client sees four tools.

## The four tools

| Tool | What it does | Read or write |
|---|---|---|
| `log_fitness_entries` | Add new workouts, meals, or body weight to today (or a specified date). | write |
| `get_fitness_history` | Read your entries (or a friend's, if they've accepted you). | read |
| `update_fitness_entry` | Replace an existing entry by ID. | write |
| `manage_friend_connections` | Add, accept, reject, remove friends — share history with people you train with. | write |

## Five things to try

### 1. Log a workout

```
"I just did 4 sets of dumbbell press, 12.5kg per side, 8 reps each set."
```

The agent calls `log_fitness_entries` with:
```json
{
  "entries": [{
    "type": "workout",
    "exercise": "Dumbbell Press",
    "exercise_key": "dumbbell_press",
    "sets": [
      { "weight_kg": 12.5, "reps": 8 },
      { "weight_kg": 12.5, "reps": 8 },
      { "weight_kg": 12.5, "reps": 8 },
      { "weight_kg": 12.5, "reps": 8 }
    ]
  }]
}
```

Response confirms the entry was stored. The `exercise_key` is normalized
(lowercase, underscores) and reused on subsequent logs so your history
clusters cleanly by exercise.

### 2. Log a meal with macros

```
"I had 2 chapatis and dal for lunch. Estimate the macros."
```

The agent reasons about portion sizes, then calls with per-item macro
estimates:
```json
{
  "entries": [{
    "type": "meal",
    "meal_type": "lunch",
    "items": [
      { "name": "chapati", "quantity": 2, "calories": 220, "protein_g": 6,  "carbs_g": 40, "fat_g": 4 },
      { "name": "dal",     "quantity": 1, "calories": 180, "protein_g": 12, "carbs_g": 30, "fat_g": 2 }
    ]
  }]
}
```

The server computes meal totals server-side; the agent doesn't need to.

### 3. Pull today's history before suggesting the next workout

```
"What did I work yesterday? Plan today's session around it."
```

The agent calls `get_fitness_history` for yesterday, sees the muscle groups
hit, and recommends complementary work. The response includes
`your_exercises` — every `exercise_key` you've ever logged — so the agent
can match new exercises to ones you already do.

### 4. Connect with a training partner

```
"My friend's code is NEXUS-R3M8. Add them."
```

`manage_friend_connections(action="add", code="NEXUS-R3M8")` sends a pending
request. The friend accepts via their own MCP client:

```
"Accept the friend request from Kushal."
```

`manage_friend_connections(action="accept", display_name="Kushal SM")`.

Once accepted, either side can pull the other's history with
`get_fitness_history(friend_id=<friend's user_id>)`.

### 5. Fix a mistake

```
"Actually that bench was at 25kg not 22.5, fix it."
```

The agent reads the most recent entry via `get_fitness_history`, gets the
`id`, and calls `update_fitness_entry(entry_id=<id>, data={...new full data...})`.

Updates are full-document replacements, not patches — the agent sends the
complete new shape. For meals, the server recomputes totals.

## What you can't do (yet)

- No bulk import from other fitness apps. Tell your agent your past PRs and
  log them one at a time, or use the CLI for scripted imports.
- No nutrition database lookup. The agent estimates macros from its own
  knowledge. Ask for second-pass refinement if a number looks off.
- No image input. Photos of food don't auto-log; describe them.
- No exercise videos / form feedback.

## The CLI

For terminal use without an MCP client:

```sh
pip install nexus-fitness
nexus login                            # opens browser for Google login
nexus log "did 3x10 squats at 60kg"    # log via natural language
nexus history                          # last 7 days
```

The CLI hits the same `mcp.nexus.kushalsm.com` endpoint via REST.

## Troubleshooting

- **"Authentication failed" on Claude.** Disconnect the Nexus connector in
  Claude → Customize → Connectors, then reconnect. Your bearer token may
  have expired beyond refresh.
- **Tool not appearing.** After connecting, restart your client's chat
  session. Most MCP clients only fetch the tool list on session start.
- **Friend code "not found."** Friend codes are case-insensitive but the
  prefix `NEXUS-` is required. Format: `NEXUS-XXXX` (4 alphanumeric chars).

## Contact

Kushal SM — kushalsokke@gmail.com.
