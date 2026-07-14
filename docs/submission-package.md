# Directory submission checklist

Status of everything Anthropic / OpenAI require to list Nexus in their
connector / app directories. Track items as they're complete.

## Claude directory (https://clau.de/mcp-directory-submission)

| Item | Status | Where it lives |
|---|---|---|
| Remote MCP URL | ✅ | `https://mcp.nexus.kushalsm.com/mcp` |
| OAuth 2.1 with PKCE | ✅ | workers-oauth-provider on Workers |
| Dynamic Client Registration | ✅ | `/register` (lib-owned) |
| Tool `title` / annotations (readOnlyHint / destructiveHint / openWorldHint) | ✅ | `workers/src/mcp.ts` |
| Privacy policy URL | ✅ | `https://nexus.kushalsm.com/privacy-policy/` |
| Public usage docs (3-5 examples) | ✅ | `https://nexus.kushalsm.com/usage-guide/` |
| Test account with sample data | ✅ | `openai-reviewer@nexus.kushalsm.com` provisioned + seeded (7 entries, goal, friend code) via `workers/scripts/seed-reviewer.mjs`; email+password sign-in verified end-to-end against production. Put the password only in the OpenAI Platform testing form, not in committed docs. |
| Origin validation on MCP endpoint | ⏳ | TODO: tighten `Origin` header check on `/mcp` |
| Connector branding (logo, name, short description) | ✅ | 256×256 PNG at `landing/public/assets/nexus-logo-256.png` (7KB, under the 10KB cap), also served on the consent page |

Submission tip from the research: missing tool annotations cause ~30% of
rejections. We're clean on that axis — every tool has explicit
read/destructive/openWorld hints.

## OpenAI / ChatGPT Apps (https://platform.openai.com/apps-manage)

| Item | Status | Where it lives |
|---|---|---|
| MCP URL | ✅ | `https://mcp.nexus.kushalsm.com/mcp` |
| Domain verification (`/.well-known/openai-apps-challenge` on the MCP host, plain text) | ✅ | `https://mcp.nexus.kushalsm.com/.well-known/openai-apps-challenge` |
| OAuth 2.1 + S256 PKCE | ✅ | workers-oauth-provider on Workers |
| Privacy policy + company URL | ✅ | `https://nexus.kushalsm.com/privacy-policy/`, `https://nexus.kushalsm.com/` |
| Screenshots | ✅ | `landing/public/assets/nexus-calorie-logged-screenshot.png` is cropped to the OpenAI requirement: exactly 706 px wide, above 400 px tall, and no prompt/debug/browser chrome. |
| Test prompts with expected responses | ✅ | Use the examples in `https://nexus.kushalsm.com/usage-guide/` plus the Testing section draft below |
| Demo OAuth credentials (no MFA) | ✅ | OAuth supports the reviewer username/password on the Nexus consent page; supply the credentials in the form |
| Tool output schemas | ✅ | `workers/src/mcp.ts` declares output schemas for all five tools; rescan in Platform after each Worker deploy and do not submit while the dashboard still shows output-schema warnings. |
| `resource` parameter echoed into token `aud` claim | ✅ | workers-oauth-provider does this; verify at test time |
| Identity verification on platform.openai.com | ✅ | Submission accepted into review on July 4, 2026 |

The known OpenAI domain-verification one-shot bug applies: get the
verification file in place BEFORE clicking submit; the retry button often
fails to re-ping.

## Domain verification

The MCP URL host is `mcp.nexus.kushalsm.com`, and the Worker serves the
OpenAI challenge at:

```
https://mcp.nexus.kushalsm.com/.well-known/openai-apps-challenge
```

Verify this with curl before every submission attempt. If the platform asks
for a different host, add the same plain-text route to that host before
retrying.

## Public URLs

- Company URL: `https://nexus.kushalsm.com/`
- MCP URL: `https://mcp.nexus.kushalsm.com/mcp`
- Privacy policy: `https://nexus.kushalsm.com/privacy-policy/`
- Terms: `https://nexus.kushalsm.com/terms-of-service/`
- Usage guide: `https://nexus.kushalsm.com/usage-guide/`

## ChatGPT testing form draft

Use the existing reviewer account in the Platform testing form:

```
username: openai-reviewer@nexus.kushalsm.com
password: stored only in the OpenAI Platform draft
```

Test cases:

| Scenario | Prompt | Tools | Expected output |
|---|---|---|---|
| User logs a strength training session | `I just did bench press, 3 sets: 60kg for 8 reps, 60kg for 7, and 55kg for 6. Log it in Nexus.` | `nexus_log_entries` | Server returns a workout entry ID, `exercise_key`, and set count. ChatGPT confirms the workout was logged. |
| User logs a meal from natural language | `I ate 3 boiled eggs for dinner. Estimate macros and log it to Nexus.` | `nexus_log_entries` | Server returns a meal entry ID, item-level foods, estimated calories/macros, and server-computed totals. |
| User corrects a previous entry | `Actually that first bench press set was 9 reps, not 8.` | `nexus_get_history`, `nexus_update_entry` | ChatGPT finds the entry, sends the full replacement data, and confirms the update result with the corrected rep count. |
| User checks their friend code | `What's my Nexus friend code?` | `nexus_manage_friends` | Server returns `your_code`, current friends, and pending requests. ChatGPT shows the friend code. |
| User sets a nutrition goal | `Set my Nexus daily goal to 2000 calories and 120g protein.` | `nexus_set_goal` | Server creates a new goal record, preserves prior goals as history, and returns the updated targets. |

Negative cases:

| Scenario | Prompt | Expected behavior |
|---|---|---|
| General fitness education | `What is hypertrophy?` | ChatGPT answers from general knowledge; no Nexus tool call. |
| Nutrition advice without logging | `How much protein should I eat per day to build muscle?` | ChatGPT answers from general knowledge; no Nexus tool call. |
| Tracking outside Nexus scope | `I slept 7 hours last night and I'm feeling stressed today.` | ChatGPT responds conversationally; no Nexus tool call. |

## Codex marketplace

Not submittable as of May 2026 — Codex self-serve plugin submission is
"coming soon." Distribute via `.codex-plugin/plugin.json` in a public
GitHub repo. Skip for now.
