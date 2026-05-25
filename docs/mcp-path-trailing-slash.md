# MCP path trailing slash — RCA and rule

**Read this before touching `mcp_path`, `_normalize_path`, `build_http_app`,
or the well-known OAuth routes.** This bug has been re-fixed at least three
times because each "fix" only solved one half of the problem and a future
agent flipped it back.

## The two failure modes that pull in opposite directions

There are two clients that disagree about what the resource URL should look
like. If you optimize for one without thinking about the other, you create
the other bug.

### Failure A — 307 redirect loop (ChatGPT, mcp-remote)

If only `/mcp/` is registered, a client that POSTs to `/mcp` (no slash)
gets a 307 from Starlette's `redirect_slashes` middleware. Some MCP
clients (notably ChatGPT and older mcp-remote builds) don't carry the
auth header through the redirect, or don't re-POST the body. The client
loops or gets a 401 it can't recover from. This is the bug fixed in
`81407b7`.

The opposite is also true: if only `/mcp` is registered and a client POSTs
to `/mcp/`, same loop in the other direction.

### Failure B — strict resource matching (Claude)

The Claude SDK fetches the protected-resource metadata doc and refuses to
connect if the `resource` field is not either the origin or an exact match
of the MCP URL it tried. The error reads:

```
Protected resource https://host/mcp/ does not match expected
https://host/mcp (or origin)
```

If we advertise `resource: ".../mcp/"` (trailing slash) but Claude tried
`.../mcp` (no slash), Claude bails before sending a single MCP message.
This is the bug that brought us here today.

## Why the two pull apart

`fastmcp.http_app(path=...)` does two things based on the value you pass:

1. Registers the streamable-HTTP endpoint at exactly that path.
2. Computes `resource_url` as `{base_url.rstrip("/")}/{path.lstrip("/")}`
   (`fastmcp/server/auth/auth.py:_get_resource_url`) — i.e. preserves
   whatever trailing slash you gave it. That `resource_url` flows into:
   - the `resource_metadata` URL in 401 `WWW-Authenticate` headers, and
   - the `resource` field of the protected-resource metadata doc.

So `path="/mcp/"` makes Claude reject; `path="/mcp"` is what Claude wants,
but then `/mcp/` requests 307 unless we explicitly handle them.

## The rule

**Canonical path is `/mcp` (no trailing slash). Both `/mcp` and `/mcp/`
serve the same content via explicit aliases. Never let one URL form 307
to the other.**

Concretely, every piece below must hold simultaneously. If you change one,
re-verify the others.

| Surface | Value |
|---|---|
| `Settings.mcp_path` default | `/mcp` |
| `_normalize_path` | leading slash, **strips** trailing slash |
| `fastmcp.http_app(path=...)` argument | `/mcp` (canonical, no slash) |
| MCP endpoint actually served at | `/mcp` *and* `/mcp/` (both 200, neither 307) |
| `resource` field in protected-resource doc | `https://host/mcp` (no slash) |
| `WWW-Authenticate: resource_metadata=...` | `.../oauth-protected-resource/mcp` (no slash) |
| Protected-resource doc served at | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource/mcp/` (all three return the no-slash `resource`) |

## How to verify in five seconds

After any change to the paths above, run these against a deployed instance
(replace host as needed):

```bash
BASE=https://nexus-tad5z6m6za-el.a.run.app

# 1. 401 from both forms, no redirect, both include resource_metadata
curl -sS -i $BASE/mcp  | grep -E '^(HTTP|www-authenticate)'
curl -sS -i $BASE/mcp/ | grep -E '^(HTTP|www-authenticate)'

# 2. Protected-resource doc — resource MUST be ".../mcp" (no slash)
curl -sS $BASE/.well-known/oauth-protected-resource     | python3 -m json.tool | grep resource
curl -sS $BASE/.well-known/oauth-protected-resource/mcp | python3 -m json.tool | grep resource
curl -sS $BASE/.well-known/oauth-protected-resource/mcp/ | python3 -m json.tool | grep resource

# 3. Regression tests
uv run python -m unittest tests.test_server -v
```

Expected: every status line is `HTTP/2 401`. Every `resource` line is
`"resource": "https://nexus-tad5z6m6za-el.a.run.app/mcp"` with no trailing
slash. If you see a 307 or a slash, you've reintroduced one of the bugs.

## Why prior fixes regressed

- `81407b7` ("Fix MCP 307 redirect loop") removed an earlier
  `path.rstrip("/")` because that earlier fix had introduced the 307. It
  pinned canonical to `/mcp/` and left `resource` advertising `/mcp/`.
  Worked against ChatGPT, broke later when Claude tightened resource
  matching.
- This file exists so the next agent (or future-me) doesn't undo the
  current state without reading both halves of the problem first.

If you genuinely need to change canonical away from `/mcp`, you must:

1. Confirm both Claude and ChatGPT/mcp-remote behavior with the new form.
2. Update the regression tests in `tests/test_server.py` so they assert
   the new invariants (both 200/401 from both forms, `resource` matches
   canonical).
3. Update this doc with the new rule, dated.
