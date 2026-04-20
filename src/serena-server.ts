import { spawn, spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pinned uvx source string. Update this when upgrading Serena. */
export const PINNED_UVX_SOURCE = "serena-agent==1.1.2";

/** Serena only listens on localhost by default in Pi. */
export const DEFAULT_HOST = "127.0.0.1";

/** Default HTTP/SSE port for Serena. */
export const DEFAULT_PORT = 40000;

/** Default Serena context for the initial Pi rollout. */
export const DEFAULT_CONTEXT = "ide";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessState = "stopped" | "starting" | "running" | "error";

/** Structured state for observability (e.g. `/serena-status`). */
export type SerenaServerState = {
  /** Full command + args used to launch Serena. */
  command: string[];
  /** Project root passed to Serena. */
  projectRoot: string;
  /** Port Serena listens on. */
  port: number;
  /** Serena context (e.g. "ide"). */
  context: string;
  /** Current lifecycle state. */
  processState: ProcessState;
  /** OS process ID, available once the process is running. */
  pid?: number;
};

/** Minimal child-process interface, narrow enough to mock in tests. */
export type ChildProcessLike = {
  pid?: number;
  kill: (signal?: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

/** Config passed to `SerenaServerManager.start()`. */
export type StartConfig = {
  /** Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Defaults to `DEFAULT_PORT`. */
  port?: number;
  /** Defaults to `DEFAULT_CONTEXT`. */
  context?: string;
};

/** Dependencies injected into `SerenaServerManager` (enables test mocking). */
export type ManagerDeps = {
  /** Returns true if `name` resolves on PATH. */
  binaryChecker: (name: string) => boolean;
  /** Spawns the process; injected so tests never fork real children. */
  spawner: (cmd: string, args: string[], opts: { cwd?: string }) => ChildProcessLike;
};

// ---------------------------------------------------------------------------
// Pure launcher-selection logic
// ---------------------------------------------------------------------------

/**
 * Resolve the full command array for launching Serena.
 *
 * Strategy (in priority order):
 * 1. Installed `serena` binary on PATH.
 * 2. Pinned `uvx -p 3.13 --from <PINNED_UVX_SOURCE> serena`.
 */
export function resolveCommand(
  projectRoot: string,
  port: number,
  context: string,
  binaryChecker: (name: string) => boolean,
): string[] {
  const serenaArgs = [
    "start-mcp-server",
    "--transport", "streamable-http",
    "--host", DEFAULT_HOST,
    "--port", String(port),
    "--context", context,
    "--project", projectRoot,
    "--enable-web-dashboard", "false",
    "--open-web-dashboard", "false",
  ];

  if (binaryChecker("serena")) {
    return ["serena", ...serenaArgs];
  }

  return ["uvx", "-p", "3.13", "--from", PINNED_UVX_SOURCE, "serena", ...serenaArgs];
}

// ---------------------------------------------------------------------------
// Lifecycle manager
// ---------------------------------------------------------------------------

/**
 * Manages a single Serena server process for a Pi session.
 *
 * - Starts once per session (idempotent start).
 * - Stops on session shutdown.
 * - Restarts when the project root changes.
 * - Exposes structured state for observability.
 *
 * Pi extension wiring is deferred to Task 6; call `start`/`stop`/`restart`
 * from there once the lifecycle hooks are bound.
 */
export class SerenaServerManager {
  private _state: SerenaServerState = {
    command: [],
    projectRoot: "",
    port: DEFAULT_PORT,
    context: DEFAULT_CONTEXT,
    processState: "stopped",
  };

  private _proc: ChildProcessLike | null = null;
  private readonly _deps: ManagerDeps;

  constructor(deps: ManagerDeps) {
    this._deps = deps;
  }

  /**
   * Start Serena. No-op if already running or starting.
   * Uses `process.cwd()` as the project root when none is provided.
   */
  start(config: StartConfig = {}): void {
    if (
      this._state.processState === "running" ||
      this._state.processState === "starting"
    ) {
      return;
    }

    const projectRoot = config.projectRoot ?? process.cwd();
    const port = config.port ?? DEFAULT_PORT;
    const context = config.context ?? DEFAULT_CONTEXT;
    const command = resolveCommand(projectRoot, port, context, this._deps.binaryChecker);

    this._state = {
      command,
      projectRoot,
      port,
      context,
      processState: "starting",
    };

    const [cmd, ...args] = command;
    let proc: ChildProcessLike;
    try {
      proc = this._deps.spawner(cmd, args, { cwd: projectRoot });
    } catch {
      this._state.processState = "error";
      return;
    }
    this._proc = proc;

    this._state.processState = "running";
    if (this._proc.pid !== undefined) {
      this._state.pid = this._proc.pid;
    }

    proc.on("exit", () => {
      if (this._proc === proc) {
        this._state.processState = "stopped";
        this._proc = null;
      }
    });

    proc.on("error", () => {
      if (this._proc === proc) {
        this._state.processState = "error";
      }
    });
  }

  /** Stop the running process. Idempotent. */
  stop(): void {
    if (this._proc) {
      this._proc.kill();
      this._proc = null;
    }
    this._state.processState = "stopped";
    delete this._state.pid;
  }

  /**
   * Stop the current process and restart with a new project root.
   * Preserves port and context from the previous session.
   */
  restart(newProjectRoot: string): void {
    const { port, context } = this._state;
    this.stop();
    this.start({ projectRoot: newProjectRoot, port, context });
  }

  /** Return a snapshot of the current server state. */
  getState(): SerenaServerState {
    return { ...this._state, command: [...this._state.command] };
  }
}

// ---------------------------------------------------------------------------
// Production-ready defaults (not used in tests)
// ---------------------------------------------------------------------------

/** Check if `name` is on PATH using `which`. */
export function defaultBinaryChecker(name: string): boolean {
  const result = spawnSync("which", [name], { stdio: "ignore" });
  return result.status === 0;
}

/** Wrap `node:child_process.spawn` to produce a `ChildProcessLike`. */
export function defaultSpawner(
  cmd: string,
  args: string[],
  opts: { cwd?: string },
): ChildProcessLike {
  return spawn(cmd, args, {
    cwd: opts.cwd,
    stdio: "ignore",
    detached: false,
  });
}
