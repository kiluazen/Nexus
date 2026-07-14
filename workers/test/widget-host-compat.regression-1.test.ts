import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { WIDGET_URI, widgetHtml } from "../src/widget/today-html";

describe("standard MCP Apps host contract", () => {
  it("uses only the standard App bridge in the widget", () => {
    const html = widgetHtml();
    expect(html).toContain("/*__NEXUS_MCP_APP_BRIDGE__*/");
    expect(html).toContain("NexusMcpBridge.connect");
    expect(html).toContain("NexusMcpBridge.callTool");
    expect(html).not.toContain("window.openai");
    expect(html).not.toContain("openai:set_globals");
  });

  it("bundles the complete standard initialization lifecycle", () => {
    const bridge = readFileSync(new URL("../vendor/mcp-app-bridge.iife.txt", import.meta.url), "utf8");
    expect(bridge).toContain("ui/initialize");
    expect(bridge).toContain("ui/notifications/initialized");
    expect(bridge).toContain("ui/notifications/tool-result");
    expect(bridge).not.toContain("window.openai");
  });

  it("builds Claude with its complete MCP Apps lifecycle, not the OpenAI bridge", () => {
    const bridge = readFileSync(new URL("../vendor/mcp-app-bridge-claude.iife.txt", import.meta.url), "utf8");
    expect(bridge).toContain("ui/initialize");
    expect(bridge).toContain("ui/notifications/tool-result");
    expect(bridge).toContain("ui/resource-teardown");
    expect(bridge).not.toContain("window.openai");
  });

  it("completes the standard handshake and receives a tool result", async () => {
    const bridgeSource = readFileSync(new URL("../vendor/mcp-app-bridge.iife.txt", import.meta.url), "utf8");
    const messages: any[] = [];
    const listeners: Record<string, Array<(event: any) => void>> = {};
    const parent = {
      postMessage(message: any) {
        messages.push(message);
      },
    };
    const element = {
      style: { height: "" },
      getBoundingClientRect: () => ({ height: 480 }),
    };
    const context: any = {
      console,
      parent,
      innerWidth: 640,
      document: { documentElement: element, body: element },
      requestAnimationFrame(callback: () => void) { callback(); return 1; },
      ResizeObserver: class {
        constructor(_callback: () => void) {}
        observe() {}
        disconnect() {}
      },
      addEventListener(type: string, listener: (event: any) => void) {
        (listeners[type] ||= []).push(listener);
      },
      removeEventListener(type: string, listener: (event: any) => void) {
        listeners[type] = (listeners[type] || []).filter((candidate) => candidate !== listener);
      },
      setTimeout,
      clearTimeout,
    };
    context.window = context;

    vm.runInNewContext(bridgeSource, context);
    let delivered: any = null;
    const connected = context.NexusMcpBridge.connect((result: any) => {
      delivered = result;
    });
    await Promise.resolve();
    await Promise.resolve();

    const initialize = messages.find((message) => message.method === "ui/initialize");
    expect(initialize).toBeTruthy();
    expect(initialize.params.appInfo).toEqual({ name: "Nexus day card", version: "1.0.0" });

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
            hostContext: {},
          },
        },
      });
    }
    await connected;

    expect(messages.some((message) => message.method === "ui/notifications/initialized")).toBe(true);

    for (const listener of listeners.message || []) {
      listener({
        source: parent,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: { ok: true }, _meta: { source: "test" } },
        },
      });
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toMatchObject({ structuredContent: { ok: true }, _meta: { source: "test" } });
  });

  it("publishes only nested standard metadata", () => {
    const source = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
    expect(source).toContain("connectDomains:");
    expect(source).toContain("ui: {");
    expect(source).toContain("resourceUri: WIDGET_URI");
    expect(source).toContain('mimeType: "text/html;profile=mcp-app"');
    expect(source).not.toContain('"openai/');
    expect(source).not.toContain("connect_domains:");
    expect(source).not.toContain('"ui/resourceUri"');
    expect(WIDGET_URI).toBe("ui://widget/nexus-today-v13.html");
  });

  it("defines isolated OpenAI and Claude deployments", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).toContain('"__MCP_HOST_TARGET__": "\\"openai\\""');
    expect(config).toContain('"__MCP_HOST_TARGET__": "\\"claude\\""');
    expect(config).toContain('"pattern": "mcp.nexus.kushalsm.com"');
    expect(config).toContain('"pattern": "claude-mcp.nexus.kushalsm.com"');
    expect(config).toContain('"__WIDGET_URI__": "\\"ui://widget/nexus-today-claude-v3.html\\""');
    expect(config).toContain(
      '"__WIDGET_DOMAIN__": "\\"9b68940b7971ea72dbbd8bcad6a73a79.claudemcpcontent.com\\""',
    );
  });
});
