# ChatGPT Apps Review Test Cases

## Test Credentials

Nexus uses OAuth. Standard users sign in with an email code, but the production
OAuth consent page also supports a preconfigured reviewer account so OpenAI can
test without inbox access, account setup, payment, MFA, or extra coordination.

Fill the Platform test-credentials field exactly like this:

```text
username: openai-reviewer@nexus.kushalsm.com
password: Nexus26!Review
```

On the Nexus consent page, enter the username as the email address and the
password in the "Code or reviewer password" field, then choose "Verify &
connect".

## Positive Test Cases

### Test Case 1

**Scenario:** Log a strength workout from natural language.

**User prompt:** I just did bench press, 3 sets: 60kg for 8 reps, 60kg for 7 reps, and 55kg for 6 reps. Log it in Nexus.

**Tool triggered:** `nexus_log_entries`

**Expected output:** Nexus creates a workout entry with `exercise_key:
bench_press`, three sets, an entry ID, and `total_sets: 3`, then ChatGPT
confirms the workout was logged.

### Test Case 2

**Scenario:** Log a meal with estimated item macros.

**User prompt:** I had lunch: 2 chapatis, egg bhurji, and a small salad. Estimate macros and log it to Nexus.

**Tool triggered:** `nexus_log_entries`

**Expected output:** ChatGPT estimates item-level calories and macros before
calling the tool. Nexus stores the meal, computes totals from the items, and
returns an entry ID, `meal_type: lunch`, totals, and `items_count`.

### Test Case 3

**Scenario:** Fetch the user's current-day summary.

**User prompt:** What did I eat and do today? Use Nexus.

**Tool triggered:** `nexus_get_history`

**Expected output:** Nexus returns today's workouts, meals, weights, exercise
keys, and `day_totals` so ChatGPT can summarize activity and nutrition.

### Test Case 4

**Scenario:** Correct a previously logged workout entry.

**User prompt:** Actually that first bench press set was 9 reps, not 8. Fix it in Nexus.

**Tool triggered:** `nexus_get_history`, then `nexus_update_entry`

**Expected output:** ChatGPT finds the relevant entry ID, sends a full
replacement with the corrected set data, and confirms that Nexus updated the
entry.

### Test Case 5

**Scenario:** Show the user's Nexus friend code and connection status.

**User prompt:** What's my Nexus friend code, and do I have any pending friend requests?

**Tool triggered:** `nexus_manage_friends`

**Expected output:** Nexus returns the user's friend code plus current friends,
pending received requests, and pending sent requests.

## Negative Test Cases

### Negative Test Case 1

**Scenario:** General workout education.

**User prompt:** What is hypertrophy and how does progressive overload work?

**Expected behavior:** Nexus should not be invoked because the request is for
general information, not logging or retrieving supported Nexus data.

### Negative Test Case 2

**Scenario:** Future workout planning.

**User prompt:** Build me a four-day push-pull-legs workout plan for next month.

**Expected behavior:** Nexus should not be invoked because it records completed
activity and history, not speculative plans.

### Negative Test Case 3

**Scenario:** Unsupported wellness tracking.

**User prompt:** I slept 7 hours last night and felt stressed today. Track that for me.

**Expected behavior:** Nexus should not be invoked because sleep, mood, and
stress tracking are outside the supported Nexus workflows.
