/**
 * pi-serena extension entry point.
 *
 * Wires Serena as the semantic backend for Pi in `replace-lsp` mode (default).
 *
 * Integration checklist (verified at runtime):
 *   [x] session_start: resolve cwd and config from .pi/settings.json
 *   [x] session_start: create SerenaServerManager and SerenaClientManager (lazy server)
 *   [x] session_start: register curated Serena tools for the current mode
 *   [x] session_start: in replace-lsp mode, disable raw Pi `lsp` via setActiveTools
 *   [x] session_start: preserve Pi built-ins (setActiveTools removes only `lsp`)
 *   [x] session_shutdown: resetClient() and stop server
 *   [x] /serena-status: show server state and current mode
 *   [x] /serena-restart: restart Serena server (also triggers lazy start)
 *   [x] /serena-mode: show or change mode (persisted to .pi/settings.json)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { readSerenaSettings, writeSerenaMode } from "../../src/settings.ts";
import { resolveConfig } from "../../src/config.ts";
import {
  DEFAULT_PORT,
  SerenaServerManager,
  defaultBinaryChecker,
  defaultSpawner,
  type StartConfig,
} from "../../src/serena-server.ts";
import { createClientManager } from "../../src/serena-client.ts";
import { syncProjectRoot } from "../../src/project-root.ts";
import { getSerenaToolDefinitionsForMode } from "../../src/serena-tools.ts";
import { shouldKeepRawLsp } from "../../src/tool-policy.ts";
import { SUPPORTED_MODES, type SerenaMode } from "../../src/modes.ts";

export default function piSerenaExtension(pi: ExtensionAPI): void {
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

  // ---------------------------------------------------------------------------
  // Per-session mutable state
  // Closed over by tool execute functions and event handlers so that the same
  // tool registrations work correctly across sessions and /reload cycles.
  // ---------------------------------------------------------------------------

  let serverMgr: SerenaServerManager | null = null;
  let clientMgr: ReturnType<typeof createClientManager> | null = null;
  let startCfg: StartConfig = {};
  let currentMode: SerenaMode = "replace-lsp";

  // Tools are registered once per name.  A Set prevents duplicate registrations
  // on /reload.  Note: if the user moves from replace-lsp to maximal across
  // sessions, the maximal-only tools are registered in the first maximal session
  // and remain registered.  The reverse (maximal → replace-lsp) leaves the extra
  // tools in the active set; this is a known minimal compromise.
  const registeredTools = new Set<string>();

  // ---------------------------------------------------------------------------
  // session_start
  // ---------------------------------------------------------------------------
  pi.on("before_agent_start", (event, _ctx) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${SERENA_RUNTIME_INSTRUCTION}`,
    };
  });
  pi.on("session_start", (_event, ctx) => {
    // 1. Read settings and derive runtime config.
    const settings = readSerenaSettings(ctx.cwd);
    const config = resolveConfig({ mode: settings.mode });
    currentMode = config.mode;

    startCfg = {
      projectRoot: ctx.cwd,
      port: DEFAULT_PORT,
      context: config.serenaContext,
    };

    // 2. Reset managers from any previous session.
    if (serverMgr) {
      serverMgr.stop();
    }
    serverMgr = new SerenaServerManager({
      binaryChecker: defaultBinaryChecker,
      spawner: defaultSpawner,
    });

    if (clientMgr) {
      // Fire-and-forget close of the previous connection.
      void clientMgr.resetClient();
    }
    clientMgr = createClientManager(DEFAULT_PORT, ctx.cwd);

    // 3. Register Serena tools for the current mode.
    //    The server is NOT started here — it starts lazily on first tool call
    //    or on /serena-restart.
    const toolDefs = getSerenaToolDefinitionsForMode(config.mode);
    for (const toolDef of toolDefs) {
      if (registeredTools.has(toolDef.name)) continue;
      registeredTools.add(toolDef.name);

      // Capture loop variable for the execute closure.
      const name = toolDef.name;

      pi.registerTool({
        name,
        label: name.replace(/_/g, " "),
        description: toolDef.description,
        // Use Type.Unsafe to pass through the JSON schema from the static registry.
        parameters: Type.Unsafe<Record<string, unknown>>(toolDef.inputSchema),

        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          if (!serverMgr || !clientMgr) {
            return {
              content: [{ type: "text", text: "Serena client not initialized" }],
              details: {},
            };
          }

          startCfg = syncProjectRoot(_ctx.cwd, startCfg, serverMgr, clientMgr);

          if (name === "restart_language_server") {
            await clientMgr.resetClient();
            serverMgr.stop();
            serverMgr.start(startCfg);
            return {
              content: [{ type: "text", text: "Serena language server restarted." }],
              details: {},
            };
          }

          // Lazy server start — idempotent if already running.
          serverMgr.start(startCfg);
          const text = await clientMgr.callSerena(name, params as Record<string, unknown>);
          return { content: [{ type: "text", text }], details: {} };
        },
      });
    }

    // 4. Apply the lsp policy.
    //    Only call setActiveTools when we need to change the active set.
    const active = pi.getActiveTools();
    if (!shouldKeepRawLsp(config.mode)) {
      // replace-lsp / maximal: remove raw `lsp` from the active set.
      if (active.includes("lsp")) {
        pi.setActiveTools(active.filter((t) => t !== "lsp"));
      }
    } else {
      // coexist: restore `lsp` if it exists in the full tool registry but is
      // absent from the active set (e.g. after a /reload from replace-lsp).
      if (!active.includes("lsp") && pi.getAllTools().includes("lsp")) {
        pi.setActiveTools([...active, "lsp"]);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // session_shutdown
  // ---------------------------------------------------------------------------

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (clientMgr) {
      await clientMgr.resetClient();
      clientMgr = null;
    }
    if (serverMgr) {
      serverMgr.stop();
      serverMgr = null;
    }
  });

  // ---------------------------------------------------------------------------
  // /serena-status
  // ---------------------------------------------------------------------------

  pi.registerCommand("serena-status", {
    description: "Show Serena server status and current mode",
    handler: async (_args, ctx) => {
      if (!serverMgr) {
        ctx.ui.notify("Serena: not initialized (no active session)", "warning");
        return;
      }
      const { processState, projectRoot, port, context, pid, command } = serverMgr.getState();
      const pidStr = pid !== undefined ? ` (pid ${pid})` : "";
      const cmdStr = command.length > 0 ? command.join(" ") : "(not resolved yet)";
      ctx.ui.notify(
        [
          `Mode:    ${currentMode}`,
          `Server:  ${processState}${pidStr}`,
          `Root:    ${projectRoot || "(none)"}`,
          `Port:    ${port}`,
          `Context: ${context}`,
          `Cmd:     ${cmdStr}`,
        ].join("\n"),
        "info",
      );
    },
  });

  // ---------------------------------------------------------------------------
  // /serena-restart
  // ---------------------------------------------------------------------------

  pi.registerCommand("serena-restart", {
    description: "Restart the Serena language server",
    handler: async (_args, ctx) => {
      if (!serverMgr) {
        ctx.ui.notify("Serena: not initialized", "warning");
        return;
      }
      if (clientMgr) {
        clientMgr.setProjectRoot(ctx.cwd);
      }
      startCfg = { ...startCfg, projectRoot: ctx.cwd };
      serverMgr.stop();
      serverMgr.start(startCfg);
      ctx.ui.notify("Serena server restarted", "info");
    },
  });

  // ---------------------------------------------------------------------------
  // /serena-mode
  // ---------------------------------------------------------------------------

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
}
