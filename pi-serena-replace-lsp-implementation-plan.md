# Pi Serena Replace-LSP Implementation Plan

**Goal:** Fork `pi-serena-tools` into a managed `~/agent-setup` package that makes Serena the default semantic backend for Pi and uses `replace-lsp` as the default operating mode.

**Architecture:** Create a new Pi package under `items-created/pi-serena/` that embeds a curated Serena bridge extension. The extension should start a pinned Serena server, initially use Serena's built-in `ide` context, expose a small semantic-first tool surface, keep Pi built-ins for general editing and shell work, and disable Pi `lsp` by default through a configurable mode layer. Keep `npm:lsp-pi` installed during the first rollout as a fallback lever; do not require removing it from Pi config on day one.

**Tech Stack:** TypeScript Pi extension package, Serena MCP over Streamable HTTP, Node test runner, npm packaging, managed-source registration in `registry.yaml`.

---

## Recommended execution mode

- Execute this plan with **sequential subagent-driven-development**.
- Use **strict red/green/refactor TDD** for every code-bearing task.
- Do **not** run implementer subagents in parallel; the tasks are too coupled for safe concurrent execution.
- Keep **Task 1**, **Task 7**, and **Task 8** in the main session.
- Execute **Task 2** through **Task 6** with fresh implementer subagents, followed by spec-compliance review and then code-quality review.
- For every coding step, require the full TDD loop:
  1. write the failing test,
  2. run it and verify the expected failure,
  3. write the minimum implementation,
  4. run tests and verify green,
  5. refactor while keeping tests green.

## Working directory conventions

- **Primary repo cwd:** `~/agent-setup`
- **Package cwd for `pi-serena` implementation, local installs, and tests:** `~/agent-setup/items-created/pi-serena`
- Unless a step explicitly says otherwise, read, write, edit, and registry operations should assume `~/agent-setup` as the controller cwd.
- Package-scoped commands should `cd ~/agent-setup/items-created/pi-serena` explicitly before running.

## Scope and design constraints

- Default mode is `replace-lsp`.
- Serena becomes the primary agent-facing semantic toolset.
- Pi built-ins stay available by default: `read`, `edit`, `smart_edit`, `write`, `bash`.
- Raw Pi `lsp` is disabled or hidden by default, but a fallback mode must exist.
- Keep `npm:lsp-pi` installed during the first rollout; default replacement happens in extension behavior, not by immediately removing the package from Pi config.
- Default Serena exposure is semantic-only, not the full Serena tool catalog.
- Initial Serena context is `ide`; a custom Serena `pi` context is explicitly deferred until the first rollout proves stable.
- Serena startup must be reproducible and pinned, not floating against latest GitHub source by default.
- The package should be managed from `~/agent-setup`, not only installed ad hoc in `~/.pi/agent`.

---

## Proposed target layout

### New managed source package
- Create: `items-created/pi-serena/package.json`
- Create: `items-created/pi-serena/README.md`
- Create: `items-created/pi-serena/extensions/pi-serena/index.ts`
- Create: `items-created/pi-serena/src/config.ts`
- Create: `items-created/pi-serena/src/modes.ts`
- Create: `items-created/pi-serena/src/serena-server.ts`
- Create: `items-created/pi-serena/src/serena-client.ts`
- Create: `items-created/pi-serena/src/serena-tools.ts`
- Create: `items-created/pi-serena/src/tool-policy.ts`
- Create: `items-created/pi-serena/src/results.ts`
- Create: `items-created/pi-serena/src/settings.ts`
- Create: `items-created/pi-serena/tests/config.test.ts`
- Create: `items-created/pi-serena/tests/modes.test.ts`
- Create: `items-created/pi-serena/tests/tool-policy.test.ts`
- Create: `items-created/pi-serena/tests/results.test.ts`
- Create: `items-created/pi-serena/tests/serena-server.test.ts`
- Create: `items-created/pi-serena/tests/serena-client.test.ts`

### Repo integration
- Modify: `registry.yaml`
- Optionally create later: `docs/pi-serena-notes.md`

---

## Task 1: Create the package scaffold in `items-created/`

**Files:**
- Create: `items-created/pi-serena/package.json`
- Create: `items-created/pi-serena/package-lock.json`
- Create: `items-created/pi-serena/.gitignore`
- Create: `items-created/pi-serena/README.md`
- Create: `items-created/pi-serena/extensions/pi-serena/index.ts`
- Create: `items-created/pi-serena/src/`
- Create: `items-created/pi-serena/tests/`

**Step 1: Write the failing packaging smoke test plan**

Document the expected package shape in `README.md` before adding runtime code:
- package name is `pi-serena`
- Pi manifest points at `./extensions`
- tests run with `node --experimental-strip-types --test`
- README explains default mode is `replace-lsp`

**Step 2: Create minimal package metadata**

Use `items-created/pi-smart-edit/package.json` as the closest local reference for package layout and test script style.

Expected initial `package.json` shape:

```json
{
  "name": "pi-serena",
  "version": "0.1.0",
  "description": "Serena-backed semantic tooling for Pi with replace-lsp as the default mode",
  "type": "module",
  "keywords": ["pi-package", "pi", "extension", "serena", "lsp"],
  "scripts": {
    "test": "node --experimental-strip-types --test tests/*.test.ts"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1"
  },
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

**Step 3: Add a minimal README**

Include:
- purpose
- mode summary
- layout summary
- test command

**Step 4: Add local package hygiene files**

Create `.gitignore` with at least:

```gitignore
node_modules/
```

Policy for the first implementation:
- commit `package-lock.json`
- never commit `node_modules/`

**Step 5: Install test-only local dependencies**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm install
```

Expected: local test execution can resolve `@mariozechner/pi-coding-agent` and `@sinclair/typebox` without depending on an external parent install, and `package-lock.json` is generated for reproducibility.

**Step 6: Run a packaging sanity check**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm pack --dry-run
```

Expected: package metadata resolves and the package structure is valid.

**Step 7: Commit**

```bash
git add items-created/pi-serena

git commit -m "feat: scaffold pi-serena package"
```

---

## Task 2: Model the package configuration and mode system

**Execution mode:** sequential subagent-driven-development with strict red/green/refactor TDD

**Files:**
- Create: `items-created/pi-serena/src/config.ts`
- Create: `items-created/pi-serena/src/modes.ts`
- Create: `items-created/pi-serena/tests/config.test.ts`
- Create: `items-created/pi-serena/tests/modes.test.ts`

**Step 1: Write failing tests for config defaults**

Test that the default resolved configuration is:
- `mode = "replace-lsp"`
- `serenaContext = "ide"`
- `rawLspEnabled = false`
- `serenaSemanticToolsOnly = true`
- `pinStrategy = "installed-first"`
- `keepInstalledLspPackage = true`

**Step 2: Write failing tests for supported modes**

Support exactly these modes initially:
- `replace-lsp` (default)
- `coexist`
- `maximal`

Expected behavior:
- `replace-lsp` disables raw `lsp`
- `coexist` keeps raw `lsp`
- `maximal` exposes broader Serena tools intentionally

**Step 3: Implement minimal config resolver**

Implement pure functions only:
- read extension-local defaults
- merge project-level `.pi/settings.json` values under `serena`
- validate mode names
- produce a normalized runtime config object

**Step 4: Run tests**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm test
```

Expected: config and mode tests pass.

**Step 5: Commit**

```bash
git add items-created/pi-serena/src/config.ts \
        items-created/pi-serena/src/modes.ts \
        items-created/pi-serena/tests/config.test.ts \
        items-created/pi-serena/tests/modes.test.ts

git commit -m "feat: add pi-serena config and mode resolution"
```

---

## Task 3: Build a pinned Serena launcher and lifecycle manager

**Execution mode:** sequential subagent-driven-development with strict red/green/refactor TDD

**Files:**
- Create: `items-created/pi-serena/src/serena-server.ts`
- Create: `items-created/pi-serena/tests/serena-server.test.ts`
- Modify: `items-created/pi-serena/README.md`

**Step 1: Write failing tests for launcher selection**

Test these cases:
- prefer installed `serena` binary when available
- otherwise fall back to pinned `uvx` ref/version
- honor optional port override
- use current Pi cwd as project root
- select Serena `ide` context for the initial rollout

**Step 2: Implement launcher policy**

Implement a manager that:
- resolves host/port
- chooses command strategy
- starts Serena once per Pi session
- stops Serena on session shutdown
- restarts when cwd/project root changes

Avoid floating latest GitHub by default. Prefer one of:
- installed binary on PATH
- pinned uvx source string

**Step 3: Expose observability hooks**

Return structured state for later use by `/serena-status`:
- command used
- project root
- port
- context
- process state

**Step 4: Run tests**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm test
```

Expected: launcher policy tests pass without requiring a live Serena install.

**Step 5: Commit**

```bash
git add items-created/pi-serena/src/serena-server.ts \
        items-created/pi-serena/tests/serena-server.test.ts \
        items-created/pi-serena/README.md

git commit -m "feat: add pinned serena server lifecycle manager"
```

---

## Task 4: Implement the Serena client and response shaping

**Execution mode:** sequential subagent-driven-development with strict red/green/refactor TDD

**Files:**
- Create: `items-created/pi-serena/src/serena-client.ts`
- Create: `items-created/pi-serena/src/results.ts`
- Create: `items-created/pi-serena/tests/serena-client.test.ts`
- Create: `items-created/pi-serena/tests/results.test.ts`

**Step 1: Write failing tests for client lifecycle**

Test that the client:
- connects lazily
- reconnects after reset
- invalidates on project-root change
- times out cleanly
- surfaces Serena errors in Pi-friendly text

**Step 2: Write failing tests for result shaping**

Test that result helpers:
- preserve text content
- truncate to Pi-like limits
- append truncation notices
- handle empty/non-text MCP payloads cleanly

**Step 3: Implement minimal client manager**

Implement:
- `getClient()`
- `resetClient()`
- `setProjectRoot()`
- `callSerena(toolName, args, timeoutMs)`

Keep all network concerns isolated from the extension entry point.

**Step 4: Run tests**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm test
```

Expected: client and result tests pass.

**Step 5: Commit**

```bash
git add items-created/pi-serena/src/serena-client.ts \
        items-created/pi-serena/src/results.ts \
        items-created/pi-serena/tests/serena-client.test.ts \
        items-created/pi-serena/tests/results.test.ts

git commit -m "feat: add serena client and pi result shaping"
```

---

## Task 5: Curate the default Serena tool surface

**Execution mode:** sequential subagent-driven-development with strict red/green/refactor TDD

**Files:**
- Create: `items-created/pi-serena/src/serena-tools.ts`
- Create: `items-created/pi-serena/src/tool-policy.ts`
- Create: `items-created/pi-serena/tests/tool-policy.test.ts`
- Modify: `items-created/pi-serena/README.md`

**Step 1: Write failing tests for default tool selection**

Default mode `replace-lsp` should expose only:
- `find_symbol`
- `get_symbols_overview`
- `find_referencing_symbols`
- `rename_symbol`
- `replace_symbol_body`
- `insert_before_symbol`
- `insert_after_symbol`
- `restart_language_server`

Optional tools must stay disabled by default.

**Step 2: Write failing tests for mode-specific policy**

Expected:
- `replace-lsp` => semantic Serena tools only
- `coexist` => same semantic tools, but raw `lsp` not disabled
- `maximal` => may expose broader Serena tools

**Step 3: Implement pure tool-policy helpers**

Implement helpers that decide:
- which Serena tools to register
- whether raw `lsp` should remain active
- whether Serena file/shell/memory tools stay hidden

**Step 4: Implement the Serena tool registration module**

Wrap only the curated default set first. Do not copy the full upstream package surface on day one.

**Step 5: Run tests**

Run:
```bash
cd ~/agent-setup/items-created/pi-serena && npm test
```

Expected: tool-policy tests pass and the README matches runtime defaults.

**Step 6: Commit**

```bash
git add items-created/pi-serena/src/serena-tools.ts \
        items-created/pi-serena/src/tool-policy.ts \
        items-created/pi-serena/tests/tool-policy.test.ts \
        items-created/pi-serena/README.md

git commit -m "feat: add curated serena semantic tool surface"
```

---

## Task 6: Wire the Pi extension entry point around `replace-lsp`

**Execution mode:** sequential subagent-driven-development with strict red/green/refactor TDD

**Files:**
- Create: `items-created/pi-serena/extensions/pi-serena/index.ts`
- Create: `items-created/pi-serena/src/settings.ts`
- Modify: `items-created/pi-serena/README.md`

**Step 1: Write the failing integration checklist in comments/tests**

Expected runtime behavior:
- on `session_start`, resolve cwd and config
- start Serena lazily
- register curated Serena tools
- in `replace-lsp` mode, disable raw Pi `lsp`
- keep Pi built-ins untouched
- on `session_shutdown`, reset client and stop server

**Step 2: Implement settings persistence**

Store package settings in project `.pi/settings.json` under:

```json
{
  "serena": {
    "mode": "replace-lsp"
  }
}
```

Later settings can add:
- launcher strategy
- raw LSP fallback
- additional Serena tool exposure

**Step 3: Implement extension lifecycle wiring**

The extension entry point should:
- build config from cwd + settings
- create server/client managers
- register tools using the curated policy
- call `pi.setActiveTools(...)` only to disable `lsp` in `replace-lsp` mode
- preserve the existing active tool set and remove only `lsp`; do not replace the active tool list with a hardcoded subset
- register commands:
  - `/serena-status`
  - `/serena-restart`
  - `/serena-mode`

**Step 4: Manually smoke-test the extension**

Run one local smoke test:
```bash
cd ~/agent-setup
pi -e ./items-created/pi-serena/extensions/pi-serena/index.ts
```

Expected manual checks:
- extension loads
- `lsp` is absent in default mode
- Serena status command works
- Pi built-ins still exist

**Step 5: Commit**

```bash
git add items-created/pi-serena/extensions/pi-serena/index.ts \
        items-created/pi-serena/src/settings.ts \
        items-created/pi-serena/README.md

git commit -m "feat: wire pi-serena replace-lsp extension runtime"
```

---

## Task 7: Register the package in `~/agent-setup`

**Files:**
- Modify: `registry.yaml`
- Optionally modify later: repo-specific package mount metadata as needed by current registration flow

**Registry decision for first rollout:**
- add `sourceRef: pi-serena` to `settings.managedPiSettings.packageEntries`
- keep `literal: npm:lsp-pi` present initially as a rollback/fallback lever
- do not require `pi config` removal of `lsp-pi` in the first implementation

**Step 1: Inspect existing package registration patterns**

Use nearby managed packages as references:
- `items-created/pi-smart-edit/`
- `items-created/pi-stuff/`

**Step 2: Add the new managed source entry**

Record:
- source id
- source path under `items-created/pi-serena`
- provenance as self-created
- package/runtime metadata appropriate for the repo-bucket model
- `sourceRef: pi-serena` under `settings.managedPiSettings.packageEntries`

Do **not** remove `literal: npm:lsp-pi` yet. The extension owns first-rollout deactivation behavior.

**Step 3: Run a dry registration or planner check**

Run the smallest relevant check for this repo’s workflow, likely one of:
```bash
cd ~/agent-setup
uv run python scripts/agent_setup_sync_planner.py
```

or a narrower registration/audit helper if more appropriate once the package exists.

**Step 4: Verify no unintended registry drift**

Expected: only the new package registration or directly related metadata changes.

**Step 5: Commit**

```bash
git add registry.yaml

git commit -m "chore: register pi-serena managed package"
```

---

## Task 8: Validate `replace-lsp` against real workflows

**Files:**
- Modify if needed: `items-created/pi-serena/README.md`
- Optionally create: `items-created/pi-serena/plans/follow-up-notes.md`

**Step 1: Define manual acceptance scenarios**

Run these scenarios in a real repo with the extension enabled:
1. locate a symbol by name
2. find references to a symbol
3. rename a symbol across files
4. replace a function body by symbol identity
5. insert code before/after a symbol
6. perform a non-semantic text edit using Pi built-ins
7. confirm raw `lsp` is absent in default mode

**Step 2: Validate failure recovery**

After external edits, run Serena restart and verify semantic tools recover:
- edit a file outside Serena-backed tools
- invoke `restart_language_server`
- confirm subsequent symbol operations work

**Step 3: Validate fallback mode**

Switch to `coexist` and verify:
- raw `lsp` becomes available again
- Serena tools remain available
- no built-in tools disappear unexpectedly

**Step 4: Update README with actual operator guidance**

Document:
- default mode behavior
- when to use `coexist`
- how to restart Serena
- what Serena replaces vs what Pi still owns
- that `lsp-pi` may still be installed during rollout even though raw `lsp` is disabled by default

**Step 5: Commit**

```bash
git add items-created/pi-serena/README.md

git commit -m "docs: finalize pi-serena replace-lsp usage notes"
```

---

## Open questions to resolve during implementation

1. **Custom Serena context.** The first rollout uses Serena `ide` context. Decide later whether a custom `pi` Serena context is worth creating for tighter prompt/tool tuning.
2. **Package removal timing.** Decide after real-world validation whether `npm:lsp-pi` should remain installed as a rollback lever or be removed from managed Pi settings entirely.
3. **Expanded Serena surface.** Decide whether tools such as `safe_delete_symbol` or selected JetBrains-backed tools should join the default curated set after the basic rollout proves stable.

## Acceptance criteria

- A new managed package exists at `items-created/pi-serena/`.
- Default runtime mode is `replace-lsp`.
- Raw Pi `lsp` is disabled by default, but a fallback mode exists.
- Pi built-ins remain available by default.
- Serena defaults to a curated semantic tool set rather than the full upstream catalog.
- Serena startup is pinned and reproducible.
- The package is registered in `registry.yaml` and added to `settings.managedPiSettings.packageEntries`.
- `npm:lsp-pi` may remain installed during first rollout, but raw `lsp` is disabled by default in `replace-lsp` mode.
- The package has automated tests for config, modes, tool policy, client/server lifecycle, and result shaping.
- Manual smoke tests confirm Serena can plausibly replace `lsp` for navigation and refactor workflows.

## Verification checklist

```bash
cd ~/agent-setup/items-created/pi-serena && npm test
```

```bash
cd ~/agent-setup
pi -e ./items-created/pi-serena/extensions/pi-serena/index.ts
```

```bash
cd ~/agent-setup
uv run python scripts/agent_setup_sync_planner.py
```

## Out of scope for the first implementation

- Agent-facing raw `lsp` diagnostics
- Agent-facing raw `lsp` code actions
- Full Serena memory/onboarding integration
- Exposing the entire Serena workflow/meta tool catalog
- JetBrains-only features as required defaults
- Automatic migration of all existing Pi sessions to the new package
- Removing Pi `lsp` implementation from the codebase entirely
