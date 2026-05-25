# ChatGPT App submission — exact form prefill

Paste the values below directly into `platform.openai.com/apps-manage → New App`.

The form has six steps: **App Info → MCP Server → Testing → Screenshots → Global → Submit**. Items marked **(user action)** require you to do something only you can do (record a video, generate a logo, complete identity verification). Everything else is copy-paste.

The form offers a `chatgpt-app-submission.json` upload that pre-fills these fields, but the OpenAI-Developers schema URL returns 404 as of 2026-05-25 — see [the community thread](https://community.openai.com/t/chatgpt-app-submission-json-schema-returns-a-404/1380746). Until OpenAI publishes a working schema, fill by hand.

---

## Step 1 — App Info

| Field | Value |
|---|---|
| Logo Icon | **(user action)** Generate a square PNG, 256×256 or larger, no border, no rounded corners. Auto-circular-cropped by clients. |
| App Name | `Nexus` |
| Subtitle (≤ 30 chars) | `Log workouts and meals` |
| Description | Nexus is a personal fitness journal that lives where your AI does. Tell ChatGPT what you ate, what you lifted, what you weigh — Nexus stores each entry against your account so ChatGPT can pull it back the next time you ask. Four tools: log workouts and meals, fetch your history, fix entries, and connect with training partners to share progress. No spreadsheets, no separate app. |
| Category | `Health & Fitness` (closest available) |
| Developer | `Kushal SM` |
| Website URL | `https://nexus.kushalsm.com` |
| Customer Support URL or Email | `kushalsokke@gmail.com` |
| Privacy Policy URL | `https://nexus.kushalsm.com/privacy-policy/` |
| Terms of Service URL | `https://nexus.kushalsm.com/terms/` *(needs to be hosted — same content as a generic ToS will pass)* |
| Demo Recording URL | **(user action)** Record in Developer Mode, upload to YouTube/Loom, paste URL. |
| App Commerce & Purchasing | `No` — no sales, no digital goods, no out-of-ChatGPT purchase links. |

## Step 2 — MCP Server

| Field | Value |
|---|---|
| MCP Server URL | `https://mcp.nexus.kushalsm.com/mcp` |
| Authentication | OAuth (PKCE S256) |
| Authorization Server | `https://mcp.nexus.kushalsm.com` |
| Token Endpoint | `https://mcp.nexus.kushalsm.com/token` |
| Authorize Endpoint | `https://mcp.nexus.kushalsm.com/authorize` |
| Dynamic Client Registration | Yes — `https://mcp.nexus.kushalsm.com/register` |
| Resource | `https://mcp.nexus.kushalsm.com/mcp` (echoed into token `aud`) |
| Scopes | `openid profile email` |

Domain verification: the Worker serves the file you generate on the submission screen at `https://mcp.nexus.kushalsm.com/.well-known/openai-apps-challenge`. The current placeholder token in the Worker is `p7WC1Y8Ev8u7vcTTDqzMy7RAZo5YtbfLifniIRJKXe8` (legacy, from the prior submission attempt). If OpenAI's submission form issues a **new** token, edit the inline string in `workers/src/handlers/default.ts` (search `openai-apps-challenge`) and redeploy **before** clicking "Verify" in the form. The verify button is one-shot per OpenAI's current behaviour — see [the community thread](https://community.openai.com/t/chatgpt-app-submissions-domain-verification-step-does-not-support-subpath-hosted-mcp-servers/1379021).

## Step 3 — Testing

Provide three test prompts and the expected behavior. Reviewers run these end-to-end.

**Prompt 1 — log a workout**

```
I just did 4 sets of dumbbell bench press, 12.5kg each side, 8 reps per set. Log it on Nexus.
```

Expected: the model calls `log_fitness_entries` with `entries: [{type:"workout", exercise:"Dumbbell Bench Press", exercise_key:"dumbbell_bench_press", sets:[{weight_kg:12.5,reps:8}×4]}]` and confirms an entry was created with an `id` and `total_sets: 4`.

**Prompt 2 — fetch history**

```
What workouts did I log this week? Use Nexus.
```

Expected: the model calls `get_fitness_history` with no args (defaults to last 7 days) and summarizes the workouts grouped by date, including the `exercise_key` list.

**Prompt 3 — log a meal with macros**

```
I had two chapatis and a bowl of dal for lunch. Log the macros to Nexus.
```

Expected: the model calls `log_fitness_entries` with per-item macro estimates (chapati: ~110 cal/3g protein/22g carbs/2g fat, dal: ~180 cal/12g protein/30g carbs/2g fat). Nexus returns server-computed totals.

## Step 4 — Screenshots (optional)

Skip for v1 — optional. If reviewers ping back, capture three:
1. The Nexus consent page (sign-in with Google).
2. A ChatGPT chat showing the workout-log tool call expanded.
3. A ChatGPT chat showing `get_fitness_history` returning a multi-day summary.

## Step 5 — Global

Locales supported: English (default). No localization needed for v1.

## Step 6 — Submit

**Demo account credentials** — provide a reviewer-only Nexus user. Create one ahead of time:
1. Open `https://mcp.nexus.kushalsm.com/authorize?response_type=code&client_id=reviewer-test&redirect_uri=https://example.com&scope=openid` in a fresh incognito.
2. Use email `nexus-reviewer@kushalsm.com` (route to your inbox via catch-all) + a strong password.
3. Pre-seed with a workout and a meal entry via the CLI so the reviewer sees data on their first `get_fitness_history` call.

Don't paste those credentials anywhere in this repo — supply them in the submission form's reviewer-credentials section directly.

**Identity verification** — **(user action)** complete individual verification at `platform.openai.com` before clicking Submit. The form blocks the final step until verification clears.

---

## What's blocking right now

- [ ] Logo PNG (square, 256×256+, no border)
- [ ] Privacy policy + ToS hosted at `nexus.kushalsm.com/privacy-policy/` and `/terms/`
- [ ] Demo recording in Developer Mode → uploaded somewhere → URL
- [ ] Reviewer Nexus account created and seeded
- [ ] OpenAI Platform identity verification

Everything else is in this doc and `submission-package.md`. The MCP server itself passes every requirement we control.
