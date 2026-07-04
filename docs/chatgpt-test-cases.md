# ChatGPT MCP App — Test Cases

## Test Credentials

Since the app uses Google OAuth via Supabase, you'll need to set up a demo account. Options:
- Create a test Google account and pre-authorize it
- Or temporarily add a bypass for a test token

**Fill in the field with:**
```
The app uses Google OAuth sign-in. On first connection, click "Continue with Google" on the consent page. No account creation needed — signing in with any Google account automatically creates a user. No 2FA required.
```

*(If they reject this because they want username/password, you'll need to create a test Google account like `nipp.test.reviewer@gmail.com` and give them the password.)*

---

## Test Case 1

**Scenario:** Log a strength workout

**User prompt:** I just did 3 sets of bench press: 60kg for 8, 60kg for 7, and 55kg for 6 reps

**Tool triggered:** history, log

**Expected output:** The server creates a workout entry with exercise_key "bench_press" and 3 sets. Response includes the entry ID and total_sets: 3. ChatGPT confirms the logged sets.

---

## Test Case 2

**Scenario:** Log a meal from a description

**User prompt:** I had lunch — 2 chapatis, egg bhurji, and a small salad

**Tool triggered:** history, log

**Expected output:** ChatGPT estimates per-item macros (calories, protein, carbs, fat) for each food item, confirms with the user, then logs the meal. Server computes totals from the individual items and returns them. Response includes entry ID, meal_type "lunch", computed totals, and items_count.

---

## Test Case 3

**Scenario:** View today's history and daily totals

**User prompt:** What did I eat and do today?

**Tool triggered:** history

**Expected output:** Server returns today's workouts and meals with day_totals showing total exercises, sets, calories, protein, carbs, fat, and meals logged. Also includes your_exercises list of all exercise keys the user has ever logged.

---

## Test Case 4

**Scenario:** Correct a previously logged entry

**User prompt:** Actually that first bench press set was 9 reps, not 8

**Tool triggered:** history, update

**Expected output:** ChatGPT retrieves the entry by ID from history, sends the complete updated data with the corrected rep count via update. Server replaces the data and returns updated: true with the new total_sets count.

---

## Test Case 5

**Scenario:** Log a cardio workout

**User prompt:** I just did 30 minutes of jiu jitsu, worked on passing guard to side control

**Tool triggered:** history, log

**Expected output:** Server creates a workout entry with exercise_key "jiu_jitsu", duration_min: 30, and the notes about guard passing. Response includes the entry ID and duration_min.

---

## Negative Test Case 1

**Scenario:** User asks for sleep or mood tracking

**User prompt:** I slept 7 hours last night and I'm feeling stressed today

**Why it shouldn't trigger:** The app only handles workouts and meals. Sleep and mood are outside its scope. ChatGPT should respond conversationally without calling any Nipp tools.

---

## Negative Test Case 2

**Scenario:** User asks for a workout plan or coaching advice

**User prompt:** Can you create a 4-day push/pull/legs workout plan for me?

**Why it shouldn't trigger:** The app logs what the user actually did — it doesn't generate workout plans. ChatGPT can answer this from its own knowledge without calling any Nipp tools.

---

## Negative Test Case 3

**Scenario:** User asks a general nutrition question

**User prompt:** How much protein should I eat per day to build muscle?

**Why it shouldn't trigger:** This is a general knowledge question, not a request to log or retrieve data. ChatGPT should answer from its own knowledge without calling any Nipp tools.
