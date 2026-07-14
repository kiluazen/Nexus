import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { widgetHtml } from "../src/widget/today-html";

// The host contract, tested against the REAL bridge bundle (the official
// @modelcontextprotocol/ext-apps App class, built by build-widget-bridge.mjs)
// and a host that answers with spec-shaped messages. No assertions about
// which vendor namespaces may exist — that's a product decision, not a
// contract (ChatGPT-only openai/* extras are legitimate additions).

const bridgeSource = () =>
  readFileSync(new URL("../vendor/mcp-app-bridge.iife.txt", import.meta.url), "utf8");

describe("widget ↔ bridge facade", () => {
  it("widget talks only to the NexusMcpBridge facade", () => {
    const html = widgetHtml();
    expect(html).toContain("/*__NEXUS_MCP_APP_BRIDGE__*/");
    expect(html).toContain("NexusMcpBridge.connect");
    expect(html).toContain("NexusMcpBridge.callTool");
    // No protocol code inline: the widget never posts JSON-RPC itself.
    expect(html).not.toContain('jsonrpc: "2.0"');
  });

  it("the bundle is the official App client with the full lifecycle", () => {
    const bridge = bridgeSource();
    expect(bridge).toContain("ui/initialize");
    expect(bridge).toContain("ui/notifications/initialized");
    expect(bridge).toContain("ui/notifications/tool-result");
    expect(bridge).toContain("ui/notifications/size-changed");
    expect(bridge).toContain("ui/resource-teardown");
  });
});

describe("standard MCP Apps handshake (real bundle, spec host)", () => {
  it("initializes, receives a tool result, reports sizes", async () => {
    const messages: any[] = [];
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const parent = { postMessage(message: any) { messages.push(message); } };
    const element: any = {
      style: {},
      getBoundingClientRect: () => ({ height: 480, width: 640 }),
      setAttribute() {},
      appendChild() {},
    };
    const context: any = {
      console,
      parent,
      innerWidth: 640,
      document: { documentElement: element, body: element, head: element, getElementById: () => null, createElement: () => ({ ...element, textContent: "" }) },
      requestAnimationFrame(callback: () => void) { callback(); return 1; },
      ResizeObserver: class { constructor(_cb: () => void) {} observe() {} disconnect() {} },
      addEventListener(type: string, listener: (event: any) => void) { (listeners[type] ||= []).push(listener); },
      removeEventListener(type: string, listener: (event: any) => void) {
        listeners[type] = (listeners[type] || []).filter((c) => c !== listener);
      },
      setTimeout, clearTimeout, MessageEvent: class {},
    };
    context.window = context;
    context.globalThis = context;

    vm.runInNewContext(bridgeSource(), context);
    let delivered: any = null;
    const connected = context.NexusMcpBridge.connect((result: any) => { delivered = result; });
    await Promise.resolve();
    await Promise.resolve();

    const initialize = messages.find((m) => m.method === "ui/initialize");
    expect(initialize).toBeTruthy();
    expect(initialize.params.appInfo?.name).toBeTruthy();
    expect(initialize.params.protocolVersion).toBeTruthy();

    for (const listener of listeners.message || []) {
      listener({
        source: parent,
        data: {
          jsonrpc: "2.0",
          id: initialize.id,
          result: {
            protocolVersion: initialize.params.protocolVersion,
            hostInfo: { name: "test-host", version: "1.0.0" },
            hostCapabilities: {},
            hostContext: { theme: "dark" },
          },
        },
      });
    }
    await connected;
    expect(messages.some((m) => m.method === "ui/notifications/initialized")).toBe(true);

    for (const listener of listeners.message || []) {
      listener({
        source: parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { content: [], structuredContent: { ok: true }, _meta: { source: "test" } },
        },
      });
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toMatchObject({ structuredContent: { ok: true }, _meta: { source: "test" } });

    // Explicit size push measures and notifies.
    context.NexusMcpBridge.sendSize();
    await Promise.resolve();
    const size = messages.find((m) => m.method === "ui/notifications/size-changed");
    expect(size).toBeTruthy();
    expect(size.params.height).toBeGreaterThan(0);
  });
});

describe("server metadata contract", () => {
  it("declares the standard ui.* surface", () => {
    const source = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
    expect(source).toContain("ui: {");
    expect(source).toContain("resourceUri: WIDGET_URI");
    expect(source).toContain('mimeType: "text/html;profile=mcp-app"');
    expect(source).toContain("connectDomains:");
  });

  it("keeps the two host deployments isolated", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).toContain('"__MCP_HOST_TARGET__": "\\"openai\\""');
    expect(config).toContain('"__MCP_HOST_TARGET__": "\\"claude\\""');
    expect(config).toContain('"pattern": "mcp.nexus.kushalsm.com"');
    expect(config).toContain('"pattern": "claude-mcp.nexus.kushalsm.com"');
    // Claude requires the hashed sandbox origin; the exact widget URI version
    // is deliberately NOT pinned here — it must bump freely.
    expect(config).toContain('"__WIDGET_DOMAIN__": "\\"9b68940b7971ea72dbbd8bcad6a73a79.claudemcpcontent.com\\""');
  });
});
