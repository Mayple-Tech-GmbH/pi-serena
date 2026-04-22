/**
 * pi-serena extension entry point.
 *
 * Wires Serena as the semantic backend for Pi in `replace-lsp` mode (default).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { readSerenaSettings, writeSerenaMode } from "../../src/settings.ts";
import { resolveConfig } from "../../src/config.ts";
import {
  DEFAULT_CONTEXT,
  DEFAULT_PORT,
  SerenaServerManager,
  defaultBinaryChecker,
  defaultSpawner,
  type StartConfig,
} from "../../src/serena-server.ts";
import { createClientManager, type SerenaClientManager } from "../../src/serena-client.ts";
import { allocateSessionPort } from "../../src/session-port.ts";
import { getSerenaToolDefinitionsForMode } from "../../src/serena-tools.ts";
import { shouldKeepRawLsp } from "../../src/tool-policy.ts";
import { SUPPORTED_MODES, type SerenaMode } from "../../src/modes.ts";

type ServerManagerLike = Pick<SerenaServerManager, "start" | "stop" | "restart" | "getState">;
type ClientManagerLike = Pick<
  SerenaClientManager,
  "getClient" | "resetClient" | "setProjectRoot" | "callSerena"
>;

type ClientFactory = (port: number, projectRoot: string) => ClientManagerLike;
type ServerFactory = () => ServerManagerLike;

export type PiSerenaExtensionDeps = {
  allocateSessionPort?: () => Promise<number>;
  createServerManager?: ServerFactory;
  createClientManager?: ClientFactory;
  startupTimeoutMs?: number;
  startupPollMs?: number;
  maxStartupAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

type EnsureStartedResult =
  | { ok: true }
  | { ok: false; text: string };

type ReadinessResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error: unknown };

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_STARTUP_POLL_MS = 250;
const DEFAULT_MAX_STARTUP_ATTEMPTS = 3;

export function createPiSerenaExtension(deps: PiSerenaExtensionDeps = {}) {
  const allocPort = deps.allocateSessionPort ?? allocateSessionPort;
  const makeServerMgr = deps.createServerManager ?? (() => new SerenaServerManager({
    binaryChecker: defaultBinaryChecker,
    spawner: defaultSpawner,
  }));
  const makeClientMgr = deps.createClientManager ?? ((port: number, projectRoot: string) =>
    createClientManager(port, projectRoot));
  const startupTimeoutMs = deps.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const startupPollMs = deps.startupPollMs ?? DEFAULT_STARTUP_POLL_MS;
  const maxStartupAttempts = deps.maxStartupAttempts ?? DEFAULT_MAX_STARTUP_ATTEMPTS;
  const sleep = deps.sleep ?? defaultSleep;

  return function piSerenaExtension(pi: ExtensionAPI): void {
    const SERENA_RUNTIME_INSTRUCTION = [
      "## Serena semantic tooling",
      "",
      "Serena semantic tools are active in this session under standard tool names such as `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`, `rename_symbol`, `replace_symbol_body`, `insert_before_symbol`, and `insert_after_symbol`.",
      "",
      "Prefer these semantic tools over `rg`/plain text search when the user is asking about exact functions, classes, methods, symbols, or real code references.",
      "",
      "Recommended order for symbol questions:",
      "1. `find_symbol` to resolve the exact symbol.",
      "2. `find_referencing_symbols` to find real usages/callers.",
      "3. `get_symbols_overview` to inspect file structure before reading large files.",
      "4. Use the symbol-aware edit/refactor tools for symbol-scoped changes.",
      "",
      "Use `rg`/plain text search as the first step only for literals and non-symbol lookups such as log messages, translation keys, CSS classes, comments, partial strings, or when semantic lookup fails.",
    ].join("\n");

    let serverMgr: ServerManagerLike | null = null;
    let clientMgr: ClientManagerLike | null = null;
    let startCfg: StartConfig = {};
    let currentMode: SerenaMode = "replace-lsp";
    let startupSucceeded = false;
    let sessionInitError: string | null = null;

    const registeredTools = new Set<string>();

    function hasManagers(): boolean {
      return serverMgr !== null && clientMgr !== null;
    }

    function recreateClientManager(port: number, projectRoot: string): ClientManagerLike {
      const next = makeClientMgr(port, projectRoot);
      clientMgr = next;
      return next;
    }

    function commitActiveProjectRoot(projectRoot: string): void {
      startCfg = { ...startCfg, projectRoot };
    }

    async function restartServerFor(projectRoot: string): Promise<void> {
      await clientMgr!.resetClient();
      clientMgr!.setProjectRoot(projectRoot);
      serverMgr!.stop();
      serverMgr!.start({ ...startCfg, projectRoot });
    }

    function statusLines(): string[] {
      if (!serverMgr) {
        return ["Serena: not initialized (no active session)"];
      }

      const state = serverMgr.getState();
      if (!startupSucceeded) {
        return [
          `Mode:    ${currentMode}`,
          "Server:  not used yet",
          `Root:    ${startCfg.projectRoot || "(none)"}`,
          `Port:    ${startCfg.port ?? DEFAULT_PORT} (provisional)`,
          `Context: ${startCfg.context ?? DEFAULT_CONTEXT}`,
          "Cmd:     (not resolved yet)",
        ];
      }

      const pidStr = state.pid !== undefined ? ` (pid ${state.pid})` : "";
      const cmdStr = state.command.length > 0 ? state.command.join(" ") : "(not resolved yet)";
      return [
        `Mode:    ${currentMode}`,
        `Server:  ${state.processState}${pidStr}`,
        `Root:    ${startCfg.projectRoot || state.projectRoot || "(none)"}`,
        `Port:    ${startCfg.port ?? state.port}`,
        `Context: ${startCfg.context ?? state.context}`,
        `Cmd:     ${cmdStr}`,
      ];
    }

    async function waitForReadiness(activeClientMgr: ClientManagerLike, activeServerMgr: ServerManagerLike): Promise<ReadinessResult> {
      const deadline = Date.now() + startupTimeoutMs;
      let lastError: unknown = null;

      while (Date.now() < deadline) {
        const processState = activeServerMgr.getState().processState;
        if (processState === "stopped" || processState === "error") {
          return {
            ok: false,
            retryable: true,
            error: new Error("Serena exited before readiness succeeded"),
          };
        }

        try {
          await activeClientMgr.getClient();
          return { ok: true };
        } catch (error) {
          lastError = error;
          if (!isRetryableTransportError(error)) {
            return { ok: false, retryable: false, error };
          }
        }

        await sleep(startupPollMs);
      }

      return {
        ok: false,
        retryable: true,
        error: lastError ?? new Error("Serena startup timed out before readiness succeeded"),
      };
    }

    function startupErrorText(projectRoot: string, error: unknown): string {
      return `Serena error: could not start for project root ${projectRoot} — ${errorMessage(error)}`;
    }

    async function ensureStarted(desiredProjectRoot: string, forceRestart = false): Promise<EnsureStartedResult> {
      if (!hasManagers()) {
        return { ok: false, text: "Serena client not initialized" };
      }
      if (sessionInitError) {
        return { ok: false, text: sessionInitError };
      }

      const activeProjectRoot = startCfg.projectRoot ?? desiredProjectRoot;
      const state = serverMgr.getState();

      if (
        startupSucceeded &&
        !forceRestart &&
        desiredProjectRoot === activeProjectRoot &&
        state.processState === "running"
      ) {
        return { ok: true };
      }

      if (!startupSucceeded) {
        let attempts = 0;
        while (attempts < maxStartupAttempts) {
          attempts++;
          await restartServerFor(desiredProjectRoot);

          const readiness = await waitForReadiness(clientMgr, serverMgr);
          if (readiness.ok) {
            commitActiveProjectRoot(desiredProjectRoot);
            startupSucceeded = true;
            return { ok: true };
          }

          serverMgr.stop();
          await clientMgr.resetClient();
          if (!readiness.retryable || attempts >= maxStartupAttempts) {
            return { ok: false, text: startupErrorText(desiredProjectRoot, readiness.error) };
          }

          try {
            const newPort = await allocPort();
            startCfg = { ...startCfg, port: newPort };
            clientMgr = recreateClientManager(newPort, desiredProjectRoot);
          } catch (error) {
            sessionInitError = `Serena error: could not allocate a session port — ${errorMessage(error)}`;
            return { ok: false, text: sessionInitError };
          }
        }
      }

      const previousProjectRoot = activeProjectRoot;
      await restartServerFor(desiredProjectRoot);

      const readiness = await waitForReadiness(clientMgr, serverMgr);
      if (!readiness.ok) {
        serverMgr.stop();
        await clientMgr.resetClient();
        recreateClientManager(startCfg.port ?? DEFAULT_PORT, previousProjectRoot);
        return { ok: false, text: startupErrorText(desiredProjectRoot, readiness.error) };
      }

      commitActiveProjectRoot(desiredProjectRoot);
      return { ok: true };
    }

    pi.on("before_agent_start", (event, _ctx) => {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${SERENA_RUNTIME_INSTRUCTION}`,
      };
    });

    pi.on("session_start", async (_event, ctx) => {
      const settings = readSerenaSettings(ctx.cwd);
      const config = resolveConfig({ mode: settings.mode });
      currentMode = config.mode;
      startupSucceeded = false;
      sessionInitError = null;

      let sessionPort: number;
      try {
        sessionPort = await allocPort();
      } catch (error) {
        sessionPort = DEFAULT_PORT;
        sessionInitError = `Serena error: could not allocate a session port — ${errorMessage(error)}`;
      }

      startCfg = {
        projectRoot: ctx.cwd,
        port: sessionPort,
        context: config.serenaContext,
      };

      if (serverMgr) {
        serverMgr.stop();
      }
      serverMgr = makeServerMgr();

      if (clientMgr) {
        await clientMgr.resetClient();
      }
      clientMgr = recreateClientManager(sessionPort, ctx.cwd);

      const toolDefs = getSerenaToolDefinitionsForMode(config.mode);
      for (const toolDef of toolDefs) {
        if (registeredTools.has(toolDef.name)) continue;
        registeredTools.add(toolDef.name);
        const name = toolDef.name;

        pi.registerTool({
          name,
          label: name.replace(/_/g, " "),
          description: toolDef.description,
          parameters: Type.Unsafe<Record<string, unknown>>(toolDef.inputSchema),

          async execute(_toolCallId, params, _signal, _onUpdate, toolCtx) {
            if (!hasManagers()) {
              return {
                content: [{ type: "text", text: "Serena client not initialized" }],
                details: {},
              };
            }

            const desiredProjectRoot = toolCtx.cwd || startCfg.projectRoot || process.cwd();
            const startResult = await ensureStarted(desiredProjectRoot, name === "restart_language_server");
            if (!startResult.ok) {
              return { content: [{ type: "text", text: startResult.text }], details: {} };
            }

            if (name === "restart_language_server") {
              return {
                content: [{ type: "text", text: "Serena language server restarted." }],
                details: {},
              };
            }

            const text = await clientMgr.callSerena(name, params as Record<string, unknown>);
            return { content: [{ type: "text", text }], details: {} };
          },
        });
      }

      const active = pi.getActiveTools();
      if (!shouldKeepRawLsp(config.mode)) {
        if (active.includes("lsp")) {
          pi.setActiveTools(active.filter((t) => t !== "lsp"));
        }
      } else if (!active.includes("lsp") && pi.getAllTools().includes("lsp")) {
        pi.setActiveTools([...active, "lsp"]);
      }
    });

    pi.on("session_shutdown", async (_event, _ctx) => {
      if (clientMgr) {
        await clientMgr.resetClient();
        clientMgr = null;
      }
      if (serverMgr) {
        serverMgr.stop();
        serverMgr = null;
      }
      startupSucceeded = false;
      sessionInitError = null;
    });

    pi.registerCommand("serena-status", {
      description: "Show Serena server status and current mode",
      handler: async (_args, ctx) => {
        if (!serverMgr) {
          ctx.ui.notify("Serena: not initialized (no active session)", "warning");
          return;
        }
        ctx.ui.notify(statusLines().join("\n"), "info");
      },
    });

    pi.registerCommand("serena-restart", {
      description: "Restart the Serena language server",
      handler: async (_args, ctx) => {
        if (!hasManagers()) {
          ctx.ui.notify("Serena: not initialized", "warning");
          return;
        }
        const result = await ensureStarted(ctx.cwd || startCfg.projectRoot || process.cwd(), true);
        if (!result.ok) {
          ctx.ui.notify(result.text, "warning");
          return;
        }
        ctx.ui.notify("Serena server restarted", "info");
      },
    });

    pi.registerCommand("serena-mode", {
      description: `Show or change the Serena mode. Usage: /serena-mode [${SUPPORTED_MODES.join("|")}]`,
      handler: async (args, ctx) => {
        const trimmed = args.trim();

        if (!trimmed) {
          ctx.ui.notify(`Serena mode: ${currentMode}`, "info");
          return;
        }

        if (!(SUPPORTED_MODES as readonly string[]).includes(trimmed)) {
          ctx.ui.notify(
            `Unknown mode: "${trimmed}". Valid modes: ${SUPPORTED_MODES.join(", ")}`,
            "warning",
          );
          return;
        }

        const newMode = trimmed as SerenaMode;
        writeSerenaMode(ctx.cwd, newMode);
        ctx.ui.notify(
          `Serena mode set to "${newMode}". Run /reload or restart to apply.`,
          "info",
        );
      },
    });
  };
}

export default createPiSerenaExtension();

function isRetryableTransportError(error: unknown): boolean {
  const text = errorMessage(error);
  return /(fetch failed|econnrefused|econnreset|ehostunreach|enetunreach|socket hang up|network|unreachable|connect)/i.test(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
