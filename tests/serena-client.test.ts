import test from "node:test";
import assert from "node:assert/strict";

import {
  SerenaClientManager,
  buildEndpoint,
  type ClientManagerDeps,
  type ClientLike,
} from "../src/serena-client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a fake MCP client that resolves callTool with a text result. */
function makeClient(
  opts: {
    callToolResult?: unknown;
    callToolError?: Error;
    connectDelay?: number;
    onConnect?: () => void;
    onClose?: () => void;
  } = {},
): ClientLike {
  return {
    connect: async (_transport) => {
      if (opts.connectDelay) {
        await new Promise((resolve) => setTimeout(resolve, opts.connectDelay));
      }
      opts.onConnect?.();
    },
    callTool: async (_params) => {
      if (opts.callToolError) throw opts.callToolError;
      return opts.callToolResult ?? { content: [{ type: "text", text: "ok" }] };
    },
    close: async () => {
      opts.onClose?.();
    },
  };
}

/** Minimal fake transport (never actually used in unit tests). */
const fakeTransport = {};


// ---------------------------------------------------------------------------
// buildEndpoint
// ---------------------------------------------------------------------------

test("buildEndpoint builds http://127.0.0.1:<port>/mcp", () => {
  const url = buildEndpoint(40000);
  assert.equal(url.href, "http://127.0.0.1:40000/mcp");
});

test("buildEndpoint uses the given port", () => {
  const url = buildEndpoint(12345);
  assert.equal(url.port, "12345");
});

// ---------------------------------------------------------------------------
// Lazy connection
// ---------------------------------------------------------------------------

test("getClient() does not connect until first call", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/p",
    clientFactory: () =>
      makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  new SerenaClientManager(deps);
  // Instantiation must not connect
  assert.equal(connectCount, 0);
});

test("getClient() connects on first call", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  await mgr.getClient();
  assert.equal(connectCount, 1);
});

test("getClient() returns same client on repeated calls (no reconnect)", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  const c1 = await mgr.getClient();
  const c2 = await mgr.getClient();
  assert.equal(connectCount, 1, "Should only connect once for repeated getClient()");
  assert.strictEqual(c1, c2, "Should return the same client object");
});

// ---------------------------------------------------------------------------
// Reset / reconnect
// ---------------------------------------------------------------------------

test("resetClient() causes next getClient() to create a fresh connection", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  await mgr.getClient();
  assert.equal(connectCount, 1);
  await mgr.resetClient();
  await mgr.getClient();
  assert.equal(connectCount, 2, "Should reconnect after reset");
});

test("resetClient() calls close on the active client", async () => {
  let closeCalled = false;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => makeClient({ onClose: () => (closeCalled = true) }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  await mgr.getClient();
  await mgr.resetClient();
  assert.ok(closeCalled, "close() should be called on reset");
});

test("resetClient() is safe when no client is connected", async () => {
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => makeClient(),
    transportFactory: () => fakeTransport,
  });
  // Should not throw
  await mgr.resetClient();
});

// ---------------------------------------------------------------------------
// Project root invalidation
// ---------------------------------------------------------------------------

test("setProjectRoot() invalidates client when root changes", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/original",
    clientFactory: () => makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  await mgr.getClient();
  assert.equal(connectCount, 1);
  mgr.setProjectRoot("/new/root");
  await mgr.getClient();
  assert.equal(connectCount, 2, "Should reconnect after project root change");
});

test("setProjectRoot() does not reconnect when root is unchanged", async () => {
  let connectCount = 0;
  const deps: ClientManagerDeps = {
    port: 40000,
    projectRoot: "/same",
    clientFactory: () => makeClient({ onConnect: () => connectCount++ }),
    transportFactory: () => fakeTransport,
  };
  const mgr = new SerenaClientManager(deps);
  await mgr.getClient();
  assert.equal(connectCount, 1);
  mgr.setProjectRoot("/same");
  await mgr.getClient();
  assert.equal(connectCount, 1, "Should NOT reconnect when root did not change");
});

// ---------------------------------------------------------------------------
// callSerena — normal usage
// ---------------------------------------------------------------------------

test("callSerena() returns shaped text result", async () => {
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () =>
      makeClient({
        callToolResult: { content: [{ type: "text", text: "file list here" }] },
      }),
    transportFactory: () => fakeTransport,
  });
  const result = await mgr.callSerena("list_files", {});
  assert.ok(result.includes("file list here"), `Got: ${result}`);
});

// ---------------------------------------------------------------------------
// callSerena — timeout
// ---------------------------------------------------------------------------

test("callSerena() resolves with timeout text when tool takes too long", async () => {
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => ({
      connect: async () => {},
      callTool: () => new Promise(() => {}), // never resolves
      close: async () => {},
    }),
    transportFactory: () => fakeTransport,
  });
  const result = await mgr.callSerena("slow_tool", {}, 20 /* 20ms timeout */);
  const hasTimeout = /timeout|timed out/i.test(result);
  assert.ok(hasTimeout, `Expected timeout message, got: ${result}`);
});

// ---------------------------------------------------------------------------
// callSerena — Serena errors
// ---------------------------------------------------------------------------

test("callSerena() surfaces thrown errors as Pi-friendly text", async () => {
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () =>
      makeClient({ callToolError: new Error("Serena boom") }),
    transportFactory: () => fakeTransport,
  });
  const result = await mgr.callSerena("broken_tool", {});
  assert.ok(result.includes("Serena boom") || /error/i.test(result), `Got: ${result}`);
});

test("callSerena() retries initial connection failures during lazy server startup", async () => {
  let connectAttempts = 0;
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => ({
      connect: async () => {
        connectAttempts++;
        if (connectAttempts < 3) {
          throw new Error("fetch failed");
        }
      },
      callTool: async () => ({ content: [{ type: "text", text: "ready" }] }),
      close: async () => {},
    }),
    transportFactory: () => fakeTransport,
  });

  const result = await mgr.callSerena("find_symbol", {}, 1000);
  assert.equal(result, "ready");
  assert.equal(connectAttempts, 3);
});

test("callSerena() resets client after timeout so next call reconnects", async () => {
  let connectCount = 0;
  let callCount = 0;
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () => ({
      connect: async () => { connectCount++; },
      callTool: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: never resolve (simulates timeout)
          await new Promise(() => {});
        }
        return { content: [{ type: "text", text: "ok" }] };
      },
      close: async () => {},
    }),
    transportFactory: () => fakeTransport,
  });

  // First call times out.
  const r1 = await mgr.callSerena("slow_tool", {}, 20);
  assert.ok(/timeout|timed out/i.test(r1), `Expected timeout, got: ${r1}`);

  // After the timeout the client should be reset, so the next call reconnects.
  // Give the async resetClient() a moment to run.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(connectCount, 1, "Connected once so far");

  const r2 = await mgr.callSerena("fast_tool", {}, 200);
  assert.equal(r2, "ok");
  assert.equal(connectCount, 2, "Should have reconnected after timeout reset");
});

test("callSerena() surfaces MCP isError results as text (not throw)", async () => {
  const mgr = new SerenaClientManager({
    port: 40000,
    projectRoot: "/p",
    clientFactory: () =>
      makeClient({
        callToolResult: {
          content: [{ type: "text", text: "tool execution failed" }],
          isError: true,
        },
      }),
    transportFactory: () => fakeTransport,
  });
  // Should not throw; should return the error text
  const result = await mgr.callSerena("bad_tool", {});
  assert.ok(result.includes("tool execution failed"), `Got: ${result}`);
});
