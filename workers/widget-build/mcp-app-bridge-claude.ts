type ToolResult = {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

const pending = new Map<number, Pending>();
let nextId = 1;
let resultHandler: ((result: ToolResult) => void) | null = null;
let connected = false;

function post(message: Record<string, unknown>) {
  window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
}

function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ id, method, params });
  });
}

function sendSize() {
  const root = document.documentElement;
  const width = Math.max(1, Math.ceil(window.innerWidth || root.scrollWidth));
  const height = Math.max(1, Math.ceil(root.scrollHeight));
  post({
    method: "ui/notifications/size-changed",
    params: { width, height },
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== "2.0") return;

  if (message.id != null && pending.has(message.id)) {
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message || "Claude MCP Apps request failed"));
    } else {
      waiter.resolve(message.result);
    }
    return;
  }

  if (message.method === "ui/notifications/tool-result") {
    resultHandler?.(message.params || {});
    requestAnimationFrame(sendSize);
    return;
  }

  // Claude can send lifecycle requests such as ping and teardown through the
  // sandbox proxy. Acknowledge requests so the host never waits indefinitely.
  if (
    message.id != null &&
    (message.method === "ping" || message.method === "ui/resource-teardown")
  ) {
    post({ id: message.id, result: {} });
  }
});

globalThis.NexusMcpBridge = {
  connect(handler: (result: ToolResult) => void): Promise<void> {
    resultHandler = handler;
    if (!connected) {
      connected = true;
      post({
        id: 0,
        method: "ui/initialize",
        params: {
          appInfo: { name: "Nexus day card", version: "1.0.0" },
          appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
          protocolVersion: "2026-01-26",
        },
      });

      // Claude currently gates both visibility and the initial tool-result
      // notification on this lifecycle notification. Sending it immediately
      // avoids the host/view deadlock where each side waits on the other.
      post({ method: "ui/notifications/initialized", params: {} });
      requestAnimationFrame(sendSize);

      const observer = new ResizeObserver(() => requestAnimationFrame(sendSize));
      observer.observe(document.documentElement);
      observer.observe(document.body);
    }
    return Promise.resolve();
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
