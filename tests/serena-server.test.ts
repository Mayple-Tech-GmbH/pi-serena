import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCommand,
  SerenaServerManager,
  PINNED_UVX_SOURCE,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_CONTEXT,
  type ChildProcessLike,
} from "../src/serena-server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockProcess(pid = 12345): ChildProcessLike {
  return {
    pid,
    kill: () => {},
    on: (_event: string, _listener: (...args: unknown[]) => void) => {},
  };
}

/** Mock process that captures event handlers so tests can fire them manually. */
function makeMockProcessCapturing(pid = 12345): {
  proc: ChildProcessLike;
  handlers: Record<string, (...args: unknown[]) => void>;
} {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const proc: ChildProcessLike = {
    pid,
    kill: () => {},
    on: (event: string, listener: (...args: unknown[]) => void) => {
      handlers[event] = listener;
    },
  };
  return { proc, handlers };
}

// ---------------------------------------------------------------------------
// resolveCommand — launcher selection
// ---------------------------------------------------------------------------

test("resolveCommand uses installed serena binary when available", () => {
  const cmd = resolveCommand("/project", DEFAULT_PORT, DEFAULT_CONTEXT, () => true);
  assert.equal(cmd[0], "serena");
});

test("resolveCommand falls back to uvx with pinned source when binary not found", () => {
  const cmd = resolveCommand("/project", DEFAULT_PORT, DEFAULT_CONTEXT, () => false);
  assert.equal(cmd[0], "uvx");
  assert.equal(cmd[1], "-p");
  assert.equal(cmd[2], "3.13");
  assert.equal(cmd[3], "--from");
  assert.equal(cmd[4], PINNED_UVX_SOURCE);
  assert.equal(cmd[5], "serena");
});

test("PINNED_UVX_SOURCE is not a floating latest reference", () => {
  // Must pin a specific version or commit — not bare 'serena' or '@main'
  assert.ok(
    PINNED_UVX_SOURCE.includes("==") || PINNED_UVX_SOURCE.includes("@"),
    `Expected a pinned version in PINNED_UVX_SOURCE, got: ${PINNED_UVX_SOURCE}`,
  );
});

test("resolveCommand includes the port in arguments", () => {
  const cmd = resolveCommand("/project", 12345, DEFAULT_CONTEXT, () => false);
  const portIdx = cmd.indexOf("--port");
  assert.ok(portIdx !== -1, "--port flag should be present");
  assert.equal(cmd[portIdx + 1], "12345");
});

test("resolveCommand uses Serena streamable-http startup command on localhost", () => {
  const cmd = resolveCommand("/project", DEFAULT_PORT, DEFAULT_CONTEXT, () => false);
  assert.ok(cmd.includes("start-mcp-server"));
  const transportIdx = cmd.indexOf("--transport");
  assert.ok(transportIdx !== -1, "--transport flag should be present");
  assert.equal(cmd[transportIdx + 1], "streamable-http");
  const hostIdx = cmd.indexOf("--host");
  assert.ok(hostIdx !== -1, "--host flag should be present");
  assert.equal(cmd[hostIdx + 1], DEFAULT_HOST);
});

test("resolveCommand disables the Serena web dashboard in Pi-managed launches", () => {
  const cmd = resolveCommand("/project", DEFAULT_PORT, DEFAULT_CONTEXT, () => false);
  const enableIdx = cmd.indexOf("--enable-web-dashboard");
  assert.ok(enableIdx !== -1, "--enable-web-dashboard flag should be present");
  assert.equal(cmd[enableIdx + 1], "false");
  const openIdx = cmd.indexOf("--open-web-dashboard");
  assert.ok(openIdx !== -1, "--open-web-dashboard flag should be present");
  assert.equal(cmd[openIdx + 1], "false");
});

test("resolveCommand includes the project root in arguments", () => {
  const root = "/my/project/root";
  const cmd = resolveCommand(root, DEFAULT_PORT, DEFAULT_CONTEXT, () => false);
  const projIdx = cmd.indexOf("--project");
  assert.ok(projIdx !== -1, "--project flag should be present");
  assert.equal(cmd[projIdx + 1], root);
});

test("resolveCommand uses ide context by default (DEFAULT_CONTEXT)", () => {
  assert.equal(DEFAULT_CONTEXT, "ide");
  const cmd = resolveCommand("/project", DEFAULT_PORT, DEFAULT_CONTEXT, () => false);
  const ctxIdx = cmd.indexOf("--context");
  assert.ok(ctxIdx !== -1, "--context flag should be present");
  assert.equal(cmd[ctxIdx + 1], "ide");
});

// ---------------------------------------------------------------------------
// SerenaServerManager — initial state
// ---------------------------------------------------------------------------

test("SerenaServerManager initial state is stopped", () => {
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => {
      throw new Error("should not spawn");
    },
  });
  const state = mgr.getState();
  assert.equal(state.processState, "stopped");
});

// ---------------------------------------------------------------------------
// SerenaServerManager — start
// ---------------------------------------------------------------------------

test("SerenaServerManager.start() sets processState to running", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().processState, "running");
});

test("SerenaServerManager.start() records command, projectRoot, port, context in state", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject", port: 9999, context: "ide" });
  const state = mgr.getState();
  assert.equal(state.projectRoot, "/myproject");
  assert.equal(state.port, 9999);
  assert.equal(state.context, "ide");
  assert.ok(Array.isArray(state.command) && state.command.length > 0);
});

test("SerenaServerManager uses DEFAULT_PORT when no port specified", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().port, DEFAULT_PORT);
});

test("SerenaServerManager uses ide context by default", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().context, DEFAULT_CONTEXT);
});

test("SerenaServerManager uses process.cwd() as default projectRoot when none provided", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start();
  assert.equal(mgr.getState().projectRoot, process.cwd());
});

// ---------------------------------------------------------------------------
// SerenaServerManager — launcher strategy
// ---------------------------------------------------------------------------

test("SerenaServerManager prefers installed serena binary when available", () => {
  const proc = makeMockProcess();
  let capturedCmd = "";
  const mgr = new SerenaServerManager({
    binaryChecker: (name) => name === "serena",
    spawner: (cmd, _args, _opts) => {
      capturedCmd = cmd;
      return proc;
    },
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(capturedCmd, "serena");
});

test("SerenaServerManager falls back to uvx when serena binary not on PATH", () => {
  const proc = makeMockProcess();
  let capturedCmd = "";
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: (cmd, _args, _opts) => {
      capturedCmd = cmd;
      return proc;
    },
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(capturedCmd, "uvx");
});

// ---------------------------------------------------------------------------
// SerenaServerManager — stop
// ---------------------------------------------------------------------------

test("SerenaServerManager.stop() clears the stored pid", () => {
  const proc = makeMockProcess(99999);
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().pid, 99999);
  mgr.stop();
  assert.equal(mgr.getState().pid, undefined);
});

test("SerenaServerManager.stop() sets processState to stopped", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  mgr.stop();
  assert.equal(mgr.getState().processState, "stopped");
});

// ---------------------------------------------------------------------------
// SerenaServerManager — idempotent start
// ---------------------------------------------------------------------------

test("SerenaServerManager.start() is idempotent: second start does not re-spawn", () => {
  let spawnCount = 0;
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => {
      spawnCount++;
      return makeMockProcess();
    },
  });
  mgr.start({ projectRoot: "/myproject" });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(spawnCount, 1);
});

// ---------------------------------------------------------------------------
// SerenaServerManager — restart on cwd change
// ---------------------------------------------------------------------------

test("SerenaServerManager.restart() re-spawns with new projectRoot", () => {
  let spawnCount = 0;
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => {
      spawnCount++;
      return makeMockProcess(spawnCount);
    },
  });
  mgr.start({ projectRoot: "/original" });
  mgr.restart("/newroot");
  const state = mgr.getState();
  assert.equal(state.projectRoot, "/newroot");
  assert.equal(state.processState, "running");
  assert.equal(spawnCount, 2);
});

// ---------------------------------------------------------------------------
// SerenaServerManager — observability (getState shape)
// ---------------------------------------------------------------------------

test("getState().command is a copy — mutations do not affect internal state", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  const snapshot = mgr.getState();
  const originalLength = mgr.getState().command.length;
  snapshot.command.push("--extra-flag");
  assert.equal(mgr.getState().command.length, originalLength);
  assert.ok(!mgr.getState().command.includes("--extra-flag"));
});

test("stale exit handler from old process does not overwrite state after restart", () => {
  const { proc: proc1, handlers: handlers1 } = makeMockProcessCapturing(1);
  const proc2 = makeMockProcess(2);

  let callCount = 0;
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => {
      callCount++;
      return callCount === 1 ? proc1 : proc2;
    },
  });

  mgr.start({ projectRoot: "/first" });
  assert.equal(mgr.getState().processState, "running");

  mgr.restart("/second");
  assert.equal(mgr.getState().processState, "running");

  // Fire the exit handler that was registered for the OLD process.
  assert.ok(handlers1["exit"], "old process should have had an exit handler attached");
  handlers1["exit"]();

  // New process state must not be overwritten.
  assert.equal(mgr.getState().processState, "running",
    "stale exit handler from old process must not overwrite running state");
});

test("stale error handler from old process does not overwrite state after restart", () => {
  const { proc: proc1, handlers: handlers1 } = makeMockProcessCapturing(1);
  const proc2 = makeMockProcess(2);

  let callCount = 0;
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => {
      callCount++;
      return callCount === 1 ? proc1 : proc2;
    },
  });

  mgr.start({ projectRoot: "/first" });
  mgr.restart("/second");

  assert.ok(handlers1["error"], "old process should have had an error handler attached");
  handlers1["error"](new Error("old process died"));

  assert.equal(mgr.getState().processState, "running",
    "stale error handler from old process must not overwrite running state");
});

test("getState returns a snapshot (not a live reference)", () => {
  const proc = makeMockProcess();
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  const s1 = mgr.getState();
  mgr.stop();
  const s2 = mgr.getState();
  // s1 should not be mutated retroactively
  assert.equal(s1.processState, "running");
  assert.equal(s2.processState, "stopped");
});

// ---------------------------------------------------------------------------
// SerenaServerManager — error state
// ---------------------------------------------------------------------------

test("error event on live process sets processState to error", () => {
  const { proc, handlers } = makeMockProcessCapturing(42);
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => proc,
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().processState, "running");

  assert.ok(handlers["error"], "error handler should be attached");
  handlers["error"](new Error("spawn failed"));

  assert.equal(mgr.getState().processState, "error");
});

test("synchronous spawner throw sets processState to error (not stuck in starting)", () => {
  const mgr = new SerenaServerManager({
    binaryChecker: () => false,
    spawner: () => { throw new Error("ENOENT"); },
  });
  mgr.start({ projectRoot: "/myproject" });
  assert.equal(mgr.getState().processState, "error");
});
