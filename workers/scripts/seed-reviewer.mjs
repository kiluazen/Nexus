// Provision (or refresh) the OpenAI reviewer account so app-review can sign in
// with email + password in ONE code-free step — no magic code, no MFA, no setup.
//
// Why this exists: sign-UP requires an emailed verification code (you can't set a
// password on an email you don't own). Reviewers can't receive that code, so the
// account must already exist. This creates it directly through the admin SDK,
// which bypasses the email-ownership step, and stores a PBKDF2 hash in the exact
// format workers/src/auth/password.ts verifies (pbkdf2$100000$salt$hash — 100k
// iterations because Cloudflare's WebCrypto caps PBKDF2 there and verify would
// throw above it). It also seeds a few days of workouts/meals + a goal so the
// reviewer's first nexus_get_history call returns real data.
//
// Run from workers/:  (loads INSTANT_* from .dev.vars + wrangler.jsonc)
//   INSTANT_APP_ID=... INSTANT_ADMIN_TOKEN=... \
//   REVIEWER_EMAIL=openai-reviewer@nexus.kushalsm.com REVIEWER_PASSWORD='Nexus26!Review' \
//   node scripts/seed-reviewer.mjs
//
// Idempotent: re-running resets the password to REVIEWER_PASSWORD and tops up
// seed data. Safe to run before every submission.
import { init, id } from "@instantdb/admin";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const APP_ID = process.env.INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const EMAIL = (process.env.REVIEWER_EMAIL || "openai-reviewer@nexus.kushalsm.com").trim().toLowerCase();
const PASSWORD = process.env.REVIEWER_PASSWORD || "Nexus26!Review";

if (!APP_ID || !ADMIN_TOKEN) {
  console.error("Missing INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in the environment.");
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error("REVIEWER_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const ITERS = 100_000; // must match workers/src/auth/password.ts (Workers WebCrypto cap)

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERS, 32, "sha256"); // 256 bits
  return `pbkdf2$${ITERS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
// Mirror of verifyPassword() so we can prove sign-in will succeed before we exit.
function verifyPassword(password, stored) {
  const [scheme, itersStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = pbkdf2Sync(password, salt, parseInt(itersStr, 10), expected.length, "sha256");
  return Buffer.compare(actual, expected) === 0;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function ensureFriendCode(db, userId, existing) {
  if (existing) return existing;
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const code = `NEXUS-${suffix}`;
    const clash = await db.query({ $users: { $: { where: { friend_code: code } } } });
    if (clash.$users.length === 0) {
      await db.transact([db.tx.$users[userId].update({ friend_code: code, created_at: Date.now() })]);
      return code;
    }
  }
  throw new Error("Could not generate a unique friend code.");
}

const dayMs = (offset) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - offset * 86_400_000;
};
const mealTotals = (c, p, cb, f) => ({ calories: c, protein_g: p, carbs_g: cb, fat_g: f });
function mealData(name, meal_type, c, p, cb, f) {
  const totals = mealTotals(c, p, cb, f);
  return { meal_type, items: [{ name, quantity: 1, ...totals }], totals };
}
function workoutData(exercise, exercise_key, sets) {
  return { exercise, exercise_key, sets };
}

// A few days of realistic history so nexus_get_history is never empty.
const SEED = [
  { day: 0, type: "workout", exercise_key: "bench_press", data: workoutData("Bench Press", "bench_press", [{ weight_kg: 60, reps: 8 }, { weight_kg: 60, reps: 7 }, { weight_kg: 55, reps: 6 }]) },
  { day: 0, type: "meal", meal_type: "lunch", data: mealData("Chicken rice bowl", "lunch", 620, 45, 60, 18) },
  { day: 0, type: "weight", data: { weight_kg: 74.5 } },
  { day: 1, type: "workout", exercise_key: "back_squat", data: workoutData("Back Squat", "back_squat", [{ weight_kg: 80, reps: 5 }, { weight_kg: 80, reps: 5 }, { weight_kg: 80, reps: 5 }]) },
  { day: 1, type: "meal", meal_type: "breakfast", data: mealData("Oats with whey and banana", "breakfast", 480, 32, 70, 9) },
  { day: 2, type: "workout", exercise_key: "deadlift", data: workoutData("Deadlift", "deadlift", [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }]) },
  { day: 2, type: "meal", meal_type: "dinner", data: mealData("Paneer bowl with roti", "dinner", 720, 38, 68, 30) },
];

async function main() {
  const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

  // 1. Ensure the $users row exists. createToken() provisions the user for a
  //    brand-new email (same call the widget uses), bypassing the code step.
  await db.auth.createToken(EMAIL);

  const res = await db.query({
    $users: { $: { where: { email: EMAIL } }, passwordCredential: {}, entries: {}, goals: {} },
  });
  const u = res.$users[0];
  if (!u) throw new Error("createToken did not provision the user — aborting.");
  const userId = u.id;

  // 2. Store / reset the password hash in the admin-only credential namespace.
  const existingCred = Array.isArray(u.passwordCredential) ? u.passwordCredential[0] : u.passwordCredential;
  const credId = existingCred?.id ?? id();
  const hash = hashPassword(PASSWORD);
  await db.transact([
    db.tx.passwordCredentials[credId].update({ hash, updated_at: Date.now() }).link({ user: userId }),
  ]);

  // 3. Friend code (skipped if already present).
  const friendCode = await ensureFriendCode(db, userId, u.friend_code);

  // 4. Seed history only if the account has none (keep re-runs from piling up).
  const hadEntries = (u.entries || []).length;
  if (hadEntries === 0) {
    const now = Date.now();
    const txs = SEED.map((e) =>
      db.tx.entries[id()]
        .update({
          type: e.type,
          entry_date: dayMs(e.day),
          exercise_key: e.exercise_key ?? undefined,
          meal_type: e.meal_type ?? undefined,
          data: e.data,
          created_at: now,
          updated_at: now,
        })
        .link({ owner: userId }),
    );
    await db.transact(txs);
  }
  if ((u.goals || []).length === 0) {
    await db.transact([
      db.tx.goals[id()]
        .update({ calorie_goal: 2200, protein_goal: 160, carbs_goal: 220, fat_goal: 70, reason: "lean bulk", created_at: Date.now() })
        .link({ owner: userId }),
    ]);
  }

  // 5. Prove the reviewer will actually get in: read the stored hash back and
  //    verify it against the password exactly as the Worker will.
  const check = await db.query({ $users: { $: { where: { email: EMAIL } }, passwordCredential: {}, entries: {} } });
  const cu = check.$users[0];
  const cc = Array.isArray(cu.passwordCredential) ? cu.passwordCredential[0] : cu.passwordCredential;
  const ok = cc && verifyPassword(PASSWORD, cc.hash);

  console.log("── reviewer account provisioned ──────────────────────────────");
  console.log("  email:       ", EMAIL);
  console.log("  password:    ", PASSWORD);
  console.log("  userId:      ", userId);
  console.log("  friend_code: ", friendCode);
  console.log("  entries:     ", (cu.entries || []).length, hadEntries === 0 ? "(seeded)" : "(kept existing)");
  console.log("  sign-in verify:", ok ? "PASS ✅ (email+password works, no code)" : "FAIL ❌");
  console.log("──────────────────────────────────────────────────────────────");
  if (!ok) process.exit(2);
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-reviewer failed:", e);
  process.exit(1);
});
