import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONTEXT, DEFAULT_PORT, type SerenaServerState, type StartConfig } from "../src/serena-server.ts";
import { createPiSerenaExtension } from "../extensions/pi-serena/index.ts";

type Notify = { message: string; level: string };

type ToolRegistration = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: { cwd: string },
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
};

type CommandRegistration = {
  handler: (args: string, ctx: { cwd: string; ui: { notify: (message: string, level: string) => void } }) => Promise<void>;
};

class FakeClientManager {
  readonly port: number;
  projectRoot: string;
  connected = false;
  getClientCalls = 0;
  resetCalls = 0;
  callSerenaCalls: string[] = [];
  setProjectRootCalls: string[] = [];
  private connectPlan: Array<"success" | Error>;
  private readonly fallback: "success" | Error;
  private readonly plansByRoot: Record<string, Array<"success" | Error>>;

  constructor(
    port: number,
    projectRoot: string,
    connectPlan: Array<"success" | Error>,
    opts: {
      fallback?: "success" | Error;
      plansByRoot?: Record<string, Array<"success" | Error>>;
    } = {},
  ) {
    this.port = port;
    this.projectRoot = projectRoot;
    this.connectPlan = [...connectPlan];
    this.fallback = opts.fallback ?? "success";
    this.plansByRoot = opts.plansByRoot ?? {};
  }

  async getClient(): Promise<object> {
    this.getClientCalls++;
    const next = this.connectPlan.shift() ?? this.fallback;
    if (next instanceof Error) throw next;
    this.connected = true;
    return {};
  }

  async resetClient(): Promise<void> {
    this.resetCalls++;
    this.connected = false;
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
    this.setProjectRootCalls.push(root);
    this.connected = false;
    const nextPlan = this.plansByRoot[root];
    if (nextPlan) {
      this.connectPlan = [...nextPlan];
    }
  }

  async callSerena(name: string): Promise<string> {
    this.callSerenaCalls.push(name);
    assert.equal(this.connected, true, "callSerena() should only run after readiness succeeds");
    return `ok:${name}`;
  }
}

class FakeServerManager {
  state: SerenaServerState = {
    command: [],
    projectRoot: "",
    port: DEFAULT_PORT,
    context: DEFAULT_CONTEXT,
    processState: "stopped",
  };
  startCalls: StartConfig[] = [];
  stopCalls = 0;

  start(config: StartConfig = {}): void {
    this.startCalls.push({ ...config });
    this.state = {
      command: ["serena", "--port", String(config.port ?? DEFAULT_PORT)],
      projectRoot: config.projectRoot ?? "",
      port: config.port ?? DEFAULT_PORT,
      context: config.context ?? DEFAULT_CONTEXT,
      processState: "running",
      pid: 123,
    };
  }

  stop(): void {
    this.stopCalls++;
    this.state = { ...this.state, processState: "stopped" };
    delete this.state.pid;
  }

  restart(newProjectRoot: string): void {
    const { port, context } = this.state;
    this.stop();
    this.start({ projectRoot: newProjectRoot, port, context });
  }

  getState(): SerenaServerState {
    return { ...this.state, command: [...this.state.command] };
  }
}

function makeMockPi() {
  const events = new Map<string, Function>();
  const tools = new Map<string, ToolRegistration>();
  const commands = new Map<string, CommandRegistration>();
  let activeTools = ["bash", "read", "lsp"];
  const allTools = ["bash", "read", "lsp"];

  return {
    api: {
      on(event: string, handler: Function) {
        events.set(event, handler);
      },
      registerTool(tool: ToolRegistration) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, command: CommandRegistration) {
        commands.set(name, command);
      },
      getActiveTools() {
        return [...activeTools];
      },
      setActiveTools(next: string[]) {
        activeTools = [...next];
      },
      getAllTools() {
        return [...allTools];
      },
    },
    events,
    tools,
    commands,
  };
}

async function runStatus(
  commands: Map<string, CommandRegistration>,
  cwd: string,
): Promise<Notify[]> {
  const notices: Notify[] = [];
  const command = commands.get("serena-status");
  assert.ok(command, "serena-status command should be registered");
  await command.handler("", {
    cwd,
    ui: {
      notify(message: string, level: string) {
        notices.push({ message, level });
      },
    },
  });
  return notices;
}

test("session_start allocates a unique port and serena-status reports not used yet before first start", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-serena-ext-"));
  const mock = makeMockPi();
  const server = new FakeServerManager();
  const clients: FakeClientManager[] = [];

  createPiSerenaExtension({
    allocateSessionPort: async () => 45123,
    createServerManager: () => server as never,
    createClientManager: (port, projectRoot) => {
      const client = new FakeClientManager(port, projectRoot, ["success"]);
      clients.push(client);
      return client as never;
    },
  })(mock.api as never);

  const sessionStart = mock.events.get("session_start");
  assert.ok(sessionStart, "session_start should be registered");
  await sessionStart({}, { cwd: tmp });

  const notices = await runStatus(mock.commands, tmp);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].port, 45123);
  assert.match(notices[0].message, /Server:\s+not used yet/);
  assert.match(notices[0].message, /Root:\s+.+pi-serena-ext-/);
  assert.match(notices[0].message, /Port:\s+45123 \(provisional\)/);
});

test("first Serena tool call waits for readiness before calling callSerena", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-serena-ext-"));
  const mock = makeMockPi();
  const server = new FakeServerManager();
  let client!: FakeClientManager;

  createPiSerenaExtension({
    allocateSessionPort: async () => 45200,
    createServerManager: () => server as never,
    createClientManager: (port, projectRoot) => {
      client = new FakeClientManager(port, projectRoot, [
        new Error("fetch failed"),
        new Error("fetch failed"),
        "success",
      ]);
      return client as never;
    },
    startupTimeoutMs: 50,
    startupPollMs: 1,
  })(mock.api as never);

  const sessionStart = mock.events.get("session_start");
  await sessionStart?.({}, { cwd: tmp });

  const tool = mock.tools.get("find_symbol");
  assert.ok(tool, "find_symbol tool should be registered");
  const result = await tool.execute("1", {}, new AbortController().signal, () => {}, { cwd: tmp });

  assert.equal(server.startCalls.length, 1);
  assert.equal(client.getClientCalls, 3);
  assert.deepEqual(client.callSerenaCalls, ["find_symbol"]);
  assert.equal(result.content[0]?.text, "ok:find_symbol");
});

test("initial startup can retry with a new provisional port and updates status to the winning port", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-serena-ext-"));
  const mock = makeMockPi();
  const server = new FakeServerManager();
  const clients: FakeClientManager[] = [];
  const allocatedPorts = [46001, 46002];

  createPiSerenaExtension({
    allocateSessionPort: async () => allocatedPorts.shift() ?? 46099,
    createServerManager: () => server as never,
    createClientManager: (port, projectRoot) => {
      const plan = clients.length === 0
        ? [new Error("fetch failed"), new Error("fetch failed"), new Error("fetch failed")]
        : ["success"];
      const client = new FakeClientManager(port, projectRoot, plan, {
        fallback: new Error("fetch failed"),
      });
      clients.push(client);
      return client as never;
    },
    startupTimeoutMs: 5,
    startupPollMs: 1,
  })(mock.api as never);

  const sessionStart = mock.events.get("session_start");
  await sessionStart?.({}, { cwd: tmp });

  const tool = mock.tools.get("find_symbol");
  assert.ok(tool, "find_symbol tool should be registered");
  const result = await tool.execute("1", {}, new AbortController().signal, () => {}, { cwd: tmp });
  const notices = await runStatus(mock.commands, tmp);

  assert.equal(result.content[0]?.text, "ok:find_symbol");
  assert.deepEqual(server.startCalls.map((call) => call.port), [46001, 46002]);
  assert.equal(clients.length, 2);
  assert.equal(clients[1].port, 46002);
  assert.match(notices[0].message, /Port:\s+46002/);
});

test("failed cwd rebind keeps the previous active project root and stable port", async () => {
  const rootA = mkdtempSync(join(tmpdir(), "pi-serena-root-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "pi-serena-root-b-"));
  const mock = makeMockPi();
  const server = new FakeServerManager();
  const clients: FakeClientManager[] = [];

  createPiSerenaExtension({
    allocateSessionPort: async () => 47001,
    createServerManager: () => server as never,
    createClientManager: (port, projectRoot) => {
      const client = new FakeClientManager(
        port,
        projectRoot,
        ["success"],
        {
          fallback: new Error("fetch failed"),
          plansByRoot: {
            [rootB]: [new Error("fetch failed"), new Error("fetch failed")],
          },
        },
      );
      clients.push(client);
      return client as never;
    },
    startupTimeoutMs: 5,
    startupPollMs: 1,
  })(mock.api as never);

  const sessionStart = mock.events.get("session_start");
  await sessionStart?.({}, { cwd: rootA });

  const tool = mock.tools.get("find_symbol");
  assert.ok(tool, "find_symbol tool should be registered");

  const first = await tool.execute("1", {}, new AbortController().signal, () => {}, { cwd: rootA });
  assert.equal(first.content[0]?.text, "ok:find_symbol");

  const second = await tool.execute("2", {}, new AbortController().signal, () => {}, { cwd: rootB });
  const notices = await runStatus(mock.commands, rootB);

  assert.match(second.content[0]?.text ?? "", /could not start for project root/i);
  assert.match(notices[0].message, new RegExp(`Root:\\s+${rootA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(notices[0].message, /Port:\s+47001/);
});
