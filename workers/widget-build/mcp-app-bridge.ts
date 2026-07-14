// The one Nexus widget bridge, identical on every host (ChatGPT, Claude, and
// anything else that speaks MCP Apps). All protocol plumbing — ui/initialize,
// tool-result delivery, tools/call, size notifications, ping/teardown replies —
// comes from the official @modelcontextprotocol/ext-apps App class. No
// hand-rolled protocol code lives in this repo.
//
// The inline widget script (today-html.ts) talks only to the NexusMcpBridge
// facade below, so this file is the single seam between Nexus UI code and the
// MCP Apps protocol.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

type ToolResult = {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

// A host that never answers ui/initialize would otherwise leave the widget
// blank forever with no signal (the Claude-iOS episode). Fail loudly instead.
const CONNECT_TIMEOUT_MS = 6000;

const app = new App(
  { name: "Nexus day card", version: "2.0.0" },
  {},
  // Backstop for organic content growth; state transitions the observer can
  // miss (editor open/close) also push explicit sizes via sendSize().
  { autoResize: true },
);

// Host theme beats any media-query guess: hosts declare light/dark plus their
// own CSS variables in hostContext, and the widget CSS keys off
// [data-theme="dark"] set here.
function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

let connectPromise: Promise<void> | null = null;
let removeToolResultListener: (() => void) | null = null;

globalThis.NexusMcpBridge = {
  connect(handler: (result: ToolResult) => void): Promise<void> {
    removeToolResultListener?.();
    const listener = (params: ToolResult) => handler(params);
    app.addEventListener("toolresult", listener);
    removeToolResultListener = () => app.removeEventListener("toolresult", listener);

    connectPromise ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.connect(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`host did not answer ui/initialize within ${CONNECT_TIMEOUT_MS}ms`)),
              CONNECT_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      applyContext(app.getHostContext());
      app.addEventListener("hostcontextchanged", () => applyContext(app.getHostContext()));
    })();
    return connectPromise;
  },

  callTool(name: string, args: Record<string, unknown>) {
    return app.callServerTool({ name, arguments: args });
  },

  hostContext(): McpUiHostContext | undefined {
    return app.getHostContext();
  },

  // Explicit size push for state transitions. Measures the document the same
  // way the SDK's autoResize does (max-content trick, so a shrink is actually
  // reported instead of ratcheting at the old height).
  sendSize(): void {
    const doc = document.documentElement;
    const prev = doc.style.height;
    doc.style.height = "max-content";
    const height = Math.ceil(doc.getBoundingClientRect().height);
    doc.style.height = prev;
    void app.sendSizeChanged({ width: Math.ceil(window.innerWidth), height });
  },
};

declare global {
  // Exposed to the separately-authored inline Nexus widget script.
  // eslint-disable-next-line no-var
  var NexusMcpBridge: {
    connect(handler: (result: ToolResult) => void): Promise<void>;
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    hostContext(): McpUiHostContext | undefined;
    sendSize(): void;
  };
}
