# OpenAI Apps SDK — What We Need to Know

Notes from reading through the full docs at developers.openai.com/apps-sdk

---

## How ChatGPT Discovers and Uses Your App

This is the core question: why did ChatGPT NOT call our tool when you
talked about food?

### Discovery is 100% metadata-driven

ChatGPT decides when to call your tools based on:

1. **Server name** — what you pass to FastMCP(). This is the app identity.
   ChatGPT sees "Nexus – Workout and Nutrition Tracker" and associates
   it with fitness/food topics.

2. **Tool name** — should be action-oriented, domain-prefixed.
   Docs recommend: `calendar.create_event`, `kanban.move_task`.
   Our `log` is too generic. Better: `nexus.log_workout_or_meal`.

3. **Tool description** — THE most important field. Must start with
   **"Use this when..."** so the model knows exactly when to pick it.
   Our description starts with "Store workout and/or meal entries" which
   is what-it-does, not when-to-use-it.

4. **Parameter docs** — describe each argument, include examples, use
   enums for constrained values.

5. **Tool hints** (MCP annotations):
   - `readOnlyHint: true` — tool only reads, never writes
   - `destructiveHint: false` — tool writes but doesn't delete
   - `openWorldHint: true` — tool sends data outside ChatGPT (emails etc)

### Two Levels of Discovery

**Direct prompts** — user names your product: "log this in Nexus"
→ This works already because user mentions the name.

**Indirect prompts** — user describes intent without naming your tool:
"I just had a masala omelette after jiu jitsu"
→ This FAILS right now because nothing in our metadata says
"use this when the user mentions eating or working out."

The fix is the tool description. The docs literally say:
> "Description – start with 'Use this when…' and call out disallowed
> cases ('Do not use for reminders')."

### Golden Prompt Set

The docs recommend creating a test set of prompts before tuning metadata:

**Direct prompts** (should trigger tool):
- "Log my workout in Nexus"
- "Add today's bench press to Nexus"
- "What did I eat yesterday?" (with Nexus connected)

**Indirect prompts** (should ALSO trigger tool):
- "I just did jiu jitsu for 90 minutes"
- "Had a 4-egg masala omelette for breakfast"
- "Did 3 sets of squats at 80kg"
- "I ate chapati and chicken curry for lunch"
- "Show me my workouts from last week"

**Negative prompts** (should NOT trigger tool):
- "What exercises should I do for shoulder pain?" (advice, not logging)
- "How many calories in a banana?" (general knowledge, not logging)
- "Create a workout plan for next week" (planning, not logging)

Test every prompt and see if ChatGPT calls the right tool.

---

## App Submission Process

### Prerequisites
1. **Organization verification** — in OpenAI Platform Dashboard
   - Individual verification (publish under your name)
   - OR organization verification (publish under company name)
   - Includes ID verification

2. **App registration** — in developer dashboard
   - App name (what users see in the directory)
   - App description (1-2 sentences, shown in search/listings)
   - App icon
   - MCP server URL
   - OAuth configuration
   - Supported countries
   - Privacy policy URL
   - Contact email

### Submission form fields
- Name
- Short description (displayed in directory)
- Long description
- Icon (square, SVG or PNG)
- Category
- Countries
- Privacy policy
- Support URL
- Screenshots (optional but recommended)

### Review process
- OpenAI reviews for compliance with App Submission Guidelines
- Tests tool functionality
- Checks metadata quality
- You get notified of approval or rejection with feedback

### Distribution after approval
Initially:
- Users find your app via direct link
- Users search by name in the directory

Eventually (if strong utility + satisfaction):
- Directory placement
- **Proactive suggestions** — ChatGPT suggests your app when relevant

That last point is key: ChatGPT can PROACTIVELY suggest "Hey, want me
to log that workout in Nexus?" — but only for apps in the directory
with good metadata and usage signals.

---

## What We Should Change (Actionable)

### 1. Tool Names — Domain Prefix

Current: `log`, `history`, `update`, `friends`
Better: `nexus_log`, `nexus_history`, `nexus_update`, `nexus_friends`

Or even more descriptive:
- `nexus_log_workout_or_meal`
- `nexus_get_history`
- `nexus_update_entry`
- `nexus_manage_friends`

The domain prefix helps ChatGPT disambiguate when multiple connectors
are installed. "log" could be anything. "nexus_log" is clearly this app.

### 2. Tool Descriptions — "Use this when..."

Current `log` description:
> "Store workout and/or meal entries for the authenticated user."

Should be:
> "Use this when the user mentions any workout, exercise, gym session,
> sport, martial arts, run, or physical activity they did. Also use
> this when the user mentions any meal, food, snack, or drink they
> consumed. Log it immediately without asking for confirmation."

Current `history` description:
> "Fetch entries for the authenticated user."

Should be:
> "Use this when the user asks about their past workouts, exercise
> history, what they ate, calories, macros, or nutrition. Also call
> this before logging to check for duplicates."

### 3. Tool Hints (MCP Annotations)

Add to tool metadata:
- `log`: `destructiveHint: false` (creates data, doesn't delete)
- `history`: `readOnlyHint: true` (only reads)
- `update`: `destructiveHint: false` (modifies but doesn't delete)
- `friends`: `destructiveHint: false`

These hints tell ChatGPT it can call `history` freely without user
confirmation, but should be a bit more careful with `log` and `update`.

### 4. Parameter Descriptions

Our params have type hints but no descriptions in the schema. Add
proper docstrings per param so the model knows what to pass:

```python
def log(
    entries: list[dict],  # List of workout or meal entries to save
    date: str | None = None,  # YYYY-MM-DD, defaults to today
) -> dict:
```

FastMCP should generate JSON Schema descriptions from the Args section
of the docstring. Verify this is happening.

---

## Monetization (from the docs)

The Apps SDK supports monetization but the docs are thin. Key points:
- You can gate features behind your own subscription
- OpenAI doesn't take a cut (yet?)
- Stripe integration is up to you
- The app can check subscription status and return different data
  for free vs paid users

---

## UX Principles (from the docs)

Key ones relevant to us:

1. **Let the model do the talking** — your tool returns data, ChatGPT
   presents it. Don't return pre-formatted messages.

2. **Be predictable** — same input should produce same output. Don't
   vary responses randomly.

3. **Fail gracefully** — return structured errors the model can relay
   to the user, not stack traces.

4. **Minimize round trips** — one tool call should do one complete job.
   Don't require multi-step sequences when one call suffices.

5. **Return machine-readable IDs** — so the model can reference entries
   in follow-up calls (we already do this with entry IDs).

---

## Developer Mode (Important)

For private/personal use, you don't need to submit to the directory.
Developer Mode lets you connect custom MCP servers directly.

This is what you're using now. The app submission process is for when
you want other people to discover and install your app.

---

## What We DON'T Have (and might want)

1. **App-level instructions/system prompt** — the docs don't mention a
   way to set a persistent system prompt for your app. Discovery is
   entirely through tool names + descriptions + the server name. There's
   no "app instructions" field like GPTs have.

2. **Proactive tool calling** — ChatGPT won't automatically call your
   tools unless the user's message triggers it via metadata matching.
   There's no "always call this tool at the start of a conversation."
   The closest thing is the proactive suggestions feature, which is
   only for directory-listed apps with strong usage.

3. **Conversation context** — your tools can't read the conversation.
   They only see what ChatGPT passes as arguments. If the user says
   "I feel tired today" your tool never sees that unless ChatGPT
   decides to pass it as a notes field.
