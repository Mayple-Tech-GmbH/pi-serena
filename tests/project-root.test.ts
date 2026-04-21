import test from "node:test";
import assert from "node:assert/strict";

import { syncProjectRoot } from "../src/project-root.ts";
import type { StartConfig, SerenaServerState } from "../src/serena-server.ts";

function makeState(overrides: Partial<SerenaServerState> = {}): SerenaServerState {
  return {
    command: [],
    projectRoot: "/initial",
    port: 40000,
    context: "ide",
    processState: "stopped",
    ...overrides,
  };
}

test("syncProjectRoot() leaves state unchanged when cwd already matches", () => {
  const startCfg: StartConfig = { projectRoot: "/same", port: 40000, context: "ide" };
  let restartedTo: string | null = null;
  let clientRoot: string | null = null;

  const next = syncProjectRoot(
    "/same",
    startCfg,
    {
      getState: () => makeState({ projectRoot: "/same", processState: "running" }),
      restart: (root: string) => {
        restartedTo = root;
      },
    },
    {
      setProjectRoot: (root: string) => {
        clientRoot = root;
      },
    },
  );

  assert.equal(next, startCfg);
  assert.equal(restartedTo, null);
  assert.equal(clientRoot, null);
});

test("syncProjectRoot() updates config without restart when Serena is stopped", () => {
  const startCfg: StartConfig = { projectRoot: "/old", port: 40000, context: "ide" };
  let restartedTo: string | null = null;
  let clientRoot: string | null = null;

  const next = syncProjectRoot(
    "/new",
    startCfg,
    {
      getState: () => makeState({ projectRoot: "/old", processState: "stopped" }),
      restart: (root: string) => {
        restartedTo = root;
      },
    },
    {
      setProjectRoot: (root: string) => {
        clientRoot = root;
      },
    },
  );

  assert.deepEqual(next, { ...startCfg, projectRoot: "/new" });
  assert.equal(restartedTo, null);
  assert.equal(clientRoot, "/new");
});

test("syncProjectRoot() restarts Serena when the active root changes", () => {
  const startCfg: StartConfig = { projectRoot: "/old", port: 40000, context: "ide" };
  let restartedTo: string | null = null;
  let clientRoot: string | null = null;

  const next = syncProjectRoot(
    "/new",
    startCfg,
    {
      getState: () => makeState({ projectRoot: "/old", processState: "running" }),
      restart: (root: string) => {
        restartedTo = root;
      },
    },
    {
      setProjectRoot: (root: string) => {
        clientRoot = root;
      },
    },
  );

  assert.deepEqual(next, { ...startCfg, projectRoot: "/new" });
  assert.equal(restartedTo, "/new");
  assert.equal(clientRoot, "/new");
});
