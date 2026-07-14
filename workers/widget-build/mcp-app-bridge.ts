type ToolResult = {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

const parentWindow = window.parent;
const pending = new Map<number, Pending>();
let nextId = 0;
let resultHandler: ((result: ToolResult) => void) | null = null;
let connectPromise: Promise<void> | null = null;

function post(message: Record<string, unknown>) {
  parentWindow.postMessage({ jsonrpc: "2.0", ...message }, "*");
}

function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ id, method, params });
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== parentWindow) return;
  const message = event.data;
  if (!message || message.jsonrpc !== "2.0") return;

  if (message.id != null && pending.has(message.id)) {
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message || "MCP Apps host request failed"));
    } else {
      waiter.resolve(message.result);
    }
    return;
  }

  if (message.method === "ui/notifications/tool-result") {
    resultHandler?.(message.params || {});
  }
}, { passive: true });

globalThis.NexusMcpBridge = {
  connect(handler: (result: ToolResult) => void): Promise<void> {
    resultHandler = handler;
    connectPromise ??= request("ui/initialize", {
      appInfo: { name: "Nexus day card", version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    }).then(() => {
      post({ method: "ui/notifications/initialized" });
    });
    return connectPromise;
  },

  callTool(name: string, args: Record<string, unknown>) {
    return request("tools/call", { name, arguments: args });
  },
};

declare global {
  // Exposed to the separately-authored inline Nexus widget script.
  // eslint-disable-next-line no-var
  var NexusMcpBridge: {
    connect(handler: (result: ToolResult) => void): Promise<void>;
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
}
