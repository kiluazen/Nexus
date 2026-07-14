import { createHash, randomBytes } from "node:crypto";

const base = process.env.NEXUS_BASE_URL || "https://mcp.nexus.kushalsm.com";
const email = process.env.REVIEWER_EMAIL;
const password = process.env.REVIEWER_PASSWORD;
const expectedWidgetUri = process.env.NEXUS_WIDGET_URI || "ui://widget/nexus-today-v15.html";
const expectedWidgetDomain = process.env.NEXUS_WIDGET_DOMAIN || "https://mcp.nexus.kushalsm.com";
const hostTarget = process.env.NEXUS_HOST_TARGET || "openai";

if (!email || !password) {
  throw new Error("Set REVIEWER_EMAIL and REVIEWER_PASSWORD for the production smoke test.");
}

const redirectUri = "http://127.0.0.1:8765/callback";
const b64url = (value) => Buffer.from(value).toString("base64url");
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash("sha256").update(verifier).digest());

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { response, body };
}

function parseMcpBody(text) {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const raw = dataLines.at(-1) || text.trim();
  return raw ? JSON.parse(raw) : null;
}

async function mcp(accessToken, sessionId, payload) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP request failed (${response.status}): ${text.slice(0, 500)}`);
  return {
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    body: text ? parseMcpBody(text) : null,
  };
}

const { body: registration } = await json(`${base}/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Nexus production smoke test",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
});

const state = b64url(randomBytes(16));
const authorize = new URL(`${base}/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: registration.client_id,
  redirect_uri: redirectUri,
  scope: "openid profile email",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: `${base}/mcp`,
}).toString();

const authResponse = await fetch(authorize, { redirect: "manual" });
assert(authResponse.status === 302, `authorize did not redirect (${authResponse.status})`);
const consentLocation = authResponse.headers.get("location");
assert(consentLocation, "authorize response omitted consent location");
const nonce = new URL(consentLocation).pathname.split("/").filter(Boolean).at(-1);
assert(nonce, "could not extract consent nonce");

const { body: decision } = await json(`${base}/oauth/decision`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nonce, action: "signin", email, password }),
});
const callback = new URL(decision.redirect_to);
assert(callback.searchParams.get("state") === state, "OAuth state mismatch");
const code = callback.searchParams.get("code");
assert(code, "OAuth callback omitted authorization code");

const tokenBody = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: registration.client_id,
  code,
  redirect_uri: redirectUri,
  code_verifier: verifier,
  resource: `${base}/mcp`,
});
const { body: token } = await json(`${base}/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: tokenBody,
});
assert(token.access_token, "token response omitted access token");

const initialized = await mcp(token.access_token, null, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "nexus-production-smoke", version: "1.0.0" },
  },
});
assert(initialized.sessionId, "MCP initialize omitted session id");
assert(initialized.body?.result?.serverInfo?.name, "MCP initialize omitted server info");

await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  method: "notifications/initialized",
});

const tools = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
});
const logTool = tools.body?.result?.tools?.find((tool) => tool.name === "nexus_log_entries");
assert(logTool, "tools/list omitted nexus_log_entries");
assert(
  logTool._meta?.ui?.resourceUri === expectedWidgetUri,
  `logging tool has the wrong standard resource URI: ${String(logTool._meta?.ui?.resourceUri)}`,
);
assert(!Object.keys(logTool._meta || {}).some((key) => key.startsWith("openai/")), "logging tool still exposes openai/* metadata");
assert(!Object.hasOwn(logTool._meta || {}, "ui/resourceUri"), "logging tool still exposes ui/resourceUri alias");

const resource = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 3,
  method: "resources/read",
  params: { uri: logTool._meta.ui.resourceUri },
});
const content = resource.body?.result?.contents?.[0];
assert(content?.mimeType === "text/html;profile=mcp-app", "widget resource has the wrong MIME type");
assert(content?._meta?.ui?.domain === expectedWidgetDomain, "widget resource has the wrong standard domain");
assert(content?.text?.includes("ui/initialize"), "widget bundle omits ui/initialize");
assert(content?.text?.includes("ui/notifications/initialized"), "widget bundle omits initialized notification");

const today = new Date().toISOString().slice(0, 10);
const canaryRun = process.env.NEXUS_CANARY_RUN || "v15";
const canaryMutationId = `nexus-smoke-${hostTarget}-${today}-${canaryRun}`;
const canaryEntry = {
  type: "meal",
  name: `Production ${hostTarget} MCP Apps canary water`,
  meal_type: "snack",
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
};
const logArguments = {
  mutation_id: canaryMutationId,
  date: today,
  entries: [canaryEntry],
};
const logged = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: {
    name: "nexus_log_entries",
    arguments: logArguments,
  },
});
assert(!logged.body?.result?.isError, "widget-bearing logging call returned an MCP error");
assert(logged.body?.result?.structuredContent?.period, "logging call omitted widget structuredContent");

const replayed = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: { name: "nexus_log_entries", arguments: logArguments },
});
assert(!replayed.body?.result?.isError, "exact mutation replay returned an MCP error");
assert(
  stableJson(replayed.body?.result?.structuredContent?.logged) ===
    stableJson(logged.body?.result?.structuredContent?.logged),
  `exact mutation replay did not return the original logged rows: ${JSON.stringify({ first: logged.body?.result?.structuredContent?.logged, replay: replayed.body?.result?.structuredContent?.logged })}`,
);

const reused = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 6,
  method: "tools/call",
  params: {
    name: "nexus_log_entries",
    arguments: { ...logArguments, entries: [{ ...canaryEntry, name: `${canaryEntry.name} changed` }] },
  },
});
assert(reused.body?.result?.isError, "mutation_id reuse with different arguments was not rejected");

const loggedRow = logged.body?.result?.structuredContent?.logged?.[0];
assert(loggedRow?.id && loggedRow?.state_version, "logged row omitted id/state_version");
const replacementData = {
  meal_type: "snack",
  items: [{ name: canaryEntry.name, quantity: 1, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }],
};
const updateArguments = {
  mutation_id: `${canaryMutationId}-update`,
  entry_id: loggedRow.id,
  expected_state_version: loggedRow.state_version,
  data: replacementData,
};
const updated = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 7,
  method: "tools/call",
  params: { name: "nexus_update_entry", arguments: updateArguments },
});
assert(!updated.body?.result?.isError, "versioned entry update returned an MCP error");
assert(updated.body?.result?.structuredContent?.state_version, "versioned entry update omitted its next state_version");

const updateReplay = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 8,
  method: "tools/call",
  params: { name: "nexus_update_entry", arguments: updateArguments },
});
assert(!updateReplay.body?.result?.isError, "exact update replay returned an MCP error");
assert(
  updateReplay.body?.result?.structuredContent?.state_version === updated.body?.result?.structuredContent?.state_version,
  "exact update replay did not return the original state version",
);

const staleUpdate = await mcp(token.access_token, initialized.sessionId, {
  jsonrpc: "2.0",
  id: 9,
  method: "tools/call",
  params: {
    name: "nexus_update_entry",
    arguments: { ...updateArguments, mutation_id: `${canaryMutationId}-stale` },
  },
});
assert(staleUpdate.body?.result?.isError, "stale state_version update was not rejected");
const widgetSession = logged.body?.result?._meta?.["nexus/widget"];
if (hostTarget === "openai") {
  assert(widgetSession?.token, "OpenAI logging call omitted widget live-session metadata");
} else {
  assert(!widgetSession?.token, "Claude logging call exposed an unused live-session credential");
  assert(
    !content?._meta?.ui?.csp?.connectDomains?.some((domain) => domain.includes("instantdb")),
    "Claude widget CSP still permits unused InstantDB connections",
  );
}

console.log(JSON.stringify({
  ok: true,
  endpoint: `${base}/mcp`,
  server: initialized.body.result.serverInfo.name,
  tools: tools.body.result.tools.length,
  widgetUri: logTool._meta.ui.resourceUri,
  mimeType: content.mimeType,
  standardHandshakePresent: true,
  legacyMetadataAbsent: true,
  widgetBearingToolCall: "passed",
  exactMutationReplay: "passed",
  conflictingMutationReuse: "rejected",
  exactUpdateReplay: "passed",
  staleUpdate: "rejected",
  hostTarget,
}, null, 2));
