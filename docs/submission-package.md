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
| Privacy policy URL | ✅ (draft) | `docs/privacy-policy.md` — needs to be hosted at a public URL |
| Public usage docs (3-5 examples) | ✅ (draft) | `docs/usage-guide.md` — needs to be hosted at a public URL |
| Test account with sample data | ✅ | `kushalsokke@gmail.com` (Supabase-issued) — supply read-only creds at submission time, NOT in this doc |
| Origin validation on MCP endpoint | ⏳ | TODO: tighten `Origin` header check on `/mcp` |
| Connector branding (logo, name, short description) | ⏳ | `nexus.kushalsm.com` favicon exists; need 256×256 PNG |

Submission tip from the research: missing tool annotations cause ~30% of
rejections. We're clean on that axis — every tool has explicit
read/destructive/openWorld hints.

## OpenAI / ChatGPT Apps (https://platform.openai.com/apps-manage)

| Item | Status | Where it lives |
|---|---|---|
| MCP URL | ✅ | `https://mcp.nexus.kushalsm.com/mcp` |
| Domain verification (`/.well-known/openai-apps-challenge` at apex, plain text) | ✅ — but currently lives at `mcp.nexus.kushalsm.com/.well-known/...`, not the apex `kushalsm.com`. Need to decide which apex OpenAI verifies against, and serve it there. |
| OAuth 2.1 + S256 PKCE | ✅ | workers-oauth-provider on Workers |
| Privacy policy + company URL | ✅ (draft) | needs public URL |
| Screenshots | ⏳ | TODO |
| Test prompts with expected responses | ⏳ | TODO — draft 3-5 |
| Demo OAuth credentials (no MFA) | ⏳ | will need to be supplied at submission time |
| `resource` parameter echoed into token `aud` claim | ✅ | workers-oauth-provider does this; verify at test time |
| Identity verification on platform.openai.com | ⏳ (user action) | Kushal needs to complete this on his OpenAI account |

The known OpenAI domain-verification one-shot bug applies: get the
verification file in place BEFORE clicking submit; the retry button often
fails to re-ping.

## Subdomain question to decide

We currently serve domain-verification at `mcp.nexus.kushalsm.com`. OpenAI's
verifier hits the apex of the domain the MCP URL is on — i.e. it'll fetch
`mcp.nexus.kushalsm.com/.well-known/openai-apps-challenge`. Our Worker
serves that already.

If OpenAI's verifier turns out to require the registered-domain apex
(`kushalsm.com/.well-known/openai-apps-challenge`), we need a separate
deployment there. Check by running the submission and watching the
verification network call before submitting for real.

## Hosting the docs publicly

The privacy policy and usage guide need stable URLs in the submission
forms. Three options, technical merit only:

1. Host them as static pages on `nexus.kushalsm.com/privacy` and
   `nexus.kushalsm.com/usage`. Existing Pages site, just add routes. **Best
   — keeps marketing site as the canonical face.**
2. Bake them into the Worker as routes. Couples docs to deploy cycle —
   worse.
3. Render them from a GitHub Pages or Notion page. Adds an external host
   the submission reviewer might mistrust — worse.

Pick (1). Static files live in the existing landing repo.

## Codex marketplace

Not submittable as of May 2026 — Codex self-serve plugin submission is
"coming soon." Distribute via `.codex-plugin/plugin.json` in a public
GitHub repo. Skip for now.
