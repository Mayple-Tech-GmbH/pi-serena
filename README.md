# pi-serena

`pi-serena` is a standalone Pi package that swaps Pi's generic symbol tools for a curated [Serena](https://github.com/oraios/serena)-backed tool set, so semantic navigation and refactors are faster and more reliable inside Pi.

## Purpose

- prefer Serena for semantic navigation and refactors in Pi
- keep Pi built-ins for general editing and shell work
- disable raw Pi `lsp` if it is present, so the semantic tool path is clear by default

## What this package is

[Serena](https://github.com/oraios/serena) is an MCP toolkit for semantic code retrieval, editing, and refactoring backed by language servers.

`pi-serena` integrates Serena into Pi as a normal package and exposes a curated Serena tool surface under Pi-friendly tool names such as:

- `find_symbol`
- `find_referencing_symbols`
- `get_symbols_overview`
- `rename_symbol`
- `replace_symbol_body`

The goal is simple: when you ask Pi symbol-aware questions, it should prefer semantic tooling instead of falling back to plain text search.

## How it works

- `pi-serena` starts and manages a dedicated Serena MCP server for the current Pi session
- it registers a focused set of Serena tools into Pi under familiar tool names
- if raw Pi `lsp` is present, it disables it by default for the session
- Pi still keeps its normal built-ins for shell work, file reads, and text edits

This gives you Serena for symbol-level navigation and refactors without replacing Pi's general-purpose workflow.

## Why use this instead of wiring plain Serena MCP yourself?

- it gives Pi a curated tool surface instead of the full Serena catalog
- it keeps Pi's normal shell and file workflow intact
- it disables raw Pi `lsp` automatically when present, so you do not have to manage that policy yourself
- it adds Pi-specific commands such as `/serena-status`, `/serena-restart`, and `/serena-mode`
- it makes Serena feel native in Pi instead of behaving like a separate generic MCP integration

## Quick start

### One-off loading

From the project you want Serena to operate on:

```bash
pi -e /path/to/pi-serena/extensions/pi-serena/index.ts
```

### Always-on install

You do **not** need to pass `-e` every time if you install `pi-serena` as a normal Pi package.

A simple local install is to place this repository at:

```text
~/.pi/agent/packages/pi-serena
```

Then add that path to `~/.pi/agent/settings.json` under `packages`, for example:

```json
{
  "packages": [
    "/Users/you/.pi/agent/packages/pi-serena"
  ]
}
```

After that, start Pi normally:

```bash
pi
```

### First commands to try

```text
/serena-status
find_symbol
find_referencing_symbols
rename_symbol
```

## Default Serena tool surface

In `replace-lsp` (default) and `coexist` modes the following Serena tools are
registered. All other Serena tools — including shell and memory tools — are
hidden regardless of mode.

| Tool | Purpose |
|---|---|
| `find_symbol` | Locate a symbol by name across the workspace |
| `get_symbols_overview` | High-level symbol overview of a file or workspace |
| `find_referencing_symbols` | Find callers / references of a symbol |
| `rename_symbol` | Project-wide rename via language server |
| `replace_symbol_body` | Replace a symbol's full body |
| `insert_before_symbol` | Insert code immediately before a symbol |
| `insert_after_symbol` | Insert code immediately after a symbol |
| `restart_language_server` | Restart the language server (included despite being optional in upstream Serena) |

In `maximal` mode the following **additional** tools are exposed on top of the
default set. This set is deliberately small — it covers common file-level
operations that complement semantic navigation without opening the full Serena
catalog.

| Tool | Purpose |
|---|---|
| `search_for_pattern` | Pattern search (grep-like) across workspace files |
| `replace_content` | Replace literal or regex-matched content in a file |
| `safe_delete_symbol` | Safely delete a symbol after checking for remaining usages |

### What stays hidden in every mode

- **Shell tools** (`execute_shell_command`, `execute_command`, …) — Pi already
  provides shell access; duplicating it would create uncoordinated execution paths.
- **Memory tools** (`create_memory`, `delete_memory`, …) — Pi manages its own
  memory layer.

## More details on how it works

The extension entry point (`extensions/pi-serena/index.ts`) wires the Pi lifecycle to the Serena server and client managers.

### Session lifecycle

| Hook | Action |
|---|---|
| `session_start` | Read `.pi/settings.json`, resolve config, create server/client managers, register Serena tools, apply lsp policy |
| `session_shutdown` | `resetClient()` (close MCP connection), `stop()` (kill Serena process) |

### Serena server lifecycle

The `SerenaServerManager` in `src/serena-server.ts` manages a single Serena process per Pi session.

#### Lazy server start

The Serena process is **not started on `session_start`**. It starts lazily
when the first Serena tool is invoked or when `/serena-restart` is called.
`SerenaServerManager.start()` is idempotent.

#### Settings persistence

Mode changes from `/serena-mode` are written to `<cwd>/.pi/settings.json`
under the `serena` key. Other keys in that file are preserved.

```json
{
  "serena": {
    "mode": "replace-lsp"
  }
}
```

#### Commands

| Command | Description |
|---|---|
| `/serena-status` | Show server process state, mode, port, and command |
| `/serena-restart` | Stop and restart the Serena process |
| `/serena-mode [mode]` | Show current mode, or set a new one (persisted) |

#### Operator guidance

- **Default behavior:** `replace-lsp` removes raw Pi `lsp` from the active tool set but keeps Pi built-ins such as `read`, `bash`, `edit`, and `write` available.
- **When to use `coexist`:** switch to `coexist` if you want the curated Serena semantic tools **and** raw `lsp` available at the same time.
- **When to use `/serena-restart`:** use it after edits that happened outside Serena-backed tools, or when semantic results look stale.
- **Directory changes:** pi-serena follows `ctx.cwd` on Serena tool calls. If you `cd` to a different project in the same Pi session, the next Serena tool call will rebind the server to that project root automatically.
- **`restart_language_server` behavior:** the Serena-facing tool of that name is implemented by pi-serena as a local client reset + Serena process restart, so it remains available even when Serena does not advertise that optional MCP tool in the active context.
- **What Serena replaces vs. what Pi still owns:** Serena handles semantic symbol search and refactors; Pi still owns general shell work and text/file editing.
- **Rollout note:** `npm:lsp-pi` may still remain installed during rollout. In `replace-lsp` mode, pi-serena hides raw `lsp` by policy instead of requiring package removal on day one.

#### Launcher strategy

1. **Installed binary** — if `serena` is found on PATH, it is used directly.
2. **Pinned uvx** — otherwise, `uvx -p 3.13 --from serena-agent==<version> serena` is used.
   The pinned source is defined as `PINNED_UVX_SOURCE` in `serena-server.ts`
   and must be updated explicitly (no floating `latest` or `@main`).

Pi launches Serena with `start-mcp-server --transport streamable-http --host 127.0.0.1`
and disables the Serena web dashboard for agent-managed sessions.

#### Default values

| Name | Default |
|---|---|
| `DEFAULT_PORT` | `40000` |
| `DEFAULT_CONTEXT` | `"ide"` |

#### Lifecycle API

```ts
const mgr = new SerenaServerManager({ binaryChecker, spawner });
mgr.start({ projectRoot, port?, context? }); // idempotent
mgr.stop();                                  // session shutdown
mgr.restart(newProjectRoot);                 // cwd change
mgr.getState();                              // snapshot for /serena-status
```

`SerenaServerManager` is used by the extension runtime to manage the Serena server lifecycle for each Pi session.
## Modes

### Mode summary

- `replace-lsp` is the default mode
- `coexist` keeps raw Pi `lsp` available as a fallback
- `maximal` allows a broader Serena surface when explicitly enabled

### lsp policy

| Mode | Action |
|---|---|
| `replace-lsp` | Calls `setActiveTools(active.filter(t => t !== 'lsp'))` to remove raw Pi lsp. All other tools are preserved. |
| `coexist` | Active tool set is untouched — Pi lsp stays available alongside Serena. |
| `maximal` | Same as `replace-lsp` (raw lsp removed). |

### Do I need to disable `lsp`?

No. `pi-serena` disables raw Pi `lsp` automatically if it is present. Many setups will not have raw `lsp` installed at all, so there is nothing extra to do.

If you want both Serena and raw `lsp`, switch to:

```text
/serena-mode coexist
/reload
```

If you want a broader Serena-only surface, use:

```text
/serena-mode maximal
/reload
```

### Tool-set compromise for mode switching

Tools are registered once per name for the lifetime of the Pi process. Moving
from `replace-lsp` to `maximal` adds the extra maximal tools on the next
session. The reverse (maximal → replace-lsp) leaves the maximal-only tools in
the registered set; they remain callable. This is a known minimal compromise
and can be addressed in a future task with explicit `setActiveTools` gating.
