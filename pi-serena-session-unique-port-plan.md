# Pi Serena Session-Unique Port Plan

## Goal

Prevent `pi-serena` from connecting to the wrong Serena server when multiple Pi sessions are open at the same time.

## Agreed design

- Allocate a **unique free port per Pi session** at `session_start`.
- Treat the initially allocated port as **provisional until the first successful Serena startup/readiness check**.
- After the first successful startup, keep the chosen port **stable for the rest of the Pi session**.
- Treat the active **cwd / project root** as the only project identity.
- On cwd changes, keep the same port and **lazily** restart Serena for the new cwd on the next Serena-backed tool call.
- Do **not** persist the port to `.pi/settings.json`.
- Keep mode persistence exactly as it is today.

## Why this fixes the bug

Today `pi-serena` uses a fixed runtime port (`40000`). If another Pi session already owns that port, a later session can accidentally connect to the old Serena process and ask semantic questions against the wrong project root.

A session-unique port removes the cross-session collision. Reusing that same port across cwd changes keeps the runtime model simple: one Pi session, one Serena endpoint, one currently indexed project root.

During initial startup only, a provisional port may be replaced if a bind race is detected before readiness succeeds. Once startup succeeds, that winning port becomes the stable session port.

## Non-goals

- No new durable state file for Serena runtime data.
- No project-derived deterministic port scheme.
- No proactive cwd watcher; cwd rebinding remains lazy on the next Serena tool call.
- No change to `serena.mode` persistence behavior.

## Current runtime state model

Runtime state already lives in memory inside the extension session:

- `extensions/pi-serena/index.ts`
  - `serverMgr`
  - `clientMgr`
  - `startCfg`
  - `currentMode`
- `src/serena-server.ts`
  - `SerenaServerManager._state.projectRoot`
  - `SerenaServerManager._state.port`
  - `SerenaServerManager._state.processState`
  - `SerenaServerManager._state.pid`
  - `SerenaServerManager._state.command`

The new session port should be remembered in `startCfg.port` and reflected in `serverMgr.getState().port`.

## Files to change

- `extensions/pi-serena/index.ts`
- `src/serena-server.ts`
- `src/serena-client.ts`
- `src/project-root.ts`
- `README.md`
- `tests/serena-server.test.ts`
- `tests/serena-client.test.ts`
- `tests/project-root.test.ts`
- `tests/extension.test.ts` (or equivalent focused extension wiring test)
- add one new focused test file if needed for port allocation behavior

## Implementation plan

### 1. Add runtime port allocation

Create a small runtime helper that asks the OS for a free localhost port.

Recommended shape:

- either a new helper in `src/session-port.ts`
- or a small helper exported from `src/serena-server.ts`

Requirements:

- bind to `127.0.0.1` with port `0`
- read back the assigned port
- close the temporary listener
- return the selected port
- fail loudly if allocation fails

This helper should be used only at `session_start`, not on every tool call.

### 2. Replace fixed runtime port usage at session start

In `extensions/pi-serena/index.ts`:

- allocate a session port during `session_start`
- store it in `startCfg.port`
- initialize `clientMgr` with that same port
- if initial startup retry replaces the provisional port, recreate or reconfigure `clientMgr` so all future MCP connections use the updated provisional port
- keep `startCfg.projectRoot = ctx.cwd`
- keep `startCfg.context = config.serenaContext`
- make `/serena-status` merge session state and live server state so it can report the provisional session port and current cwd immediately after `session_start`, even before the first lazy Serena start

Important:

- `DEFAULT_PORT` can stay as a test/documentation constant if useful, but it should no longer be the default live-session behavior.
- The extension should not rely on `40000` once the session is running.
### 2a. Define `/serena-status` before first use

Before the first successful lazy Serena startup, `/serena-status` should report from session state rather than pretending there is already a live Serena process.

Required behavior before first use:

- report `mode` from current extension/session state
- report `root` from `startCfg.projectRoot`
- report the provisional session port from `startCfg.port`
- label the server state as `not used yet`
- if initial startup retries to a different provisional port, status should reflect the updated provisional session port immediately

After the first successful startup, `/serena-status` should continue to report session-facing data, but use `serverMgr.getState()` for live process details such as running/stopped state, pid, command, and the stable session port.

This keeps `SerenaServerManager` focused on live process state while letting the status command present the full session picture.
### 3. Preserve the session port across restarts

Ensure the same port survives all normal runtime transitions after the first successful startup:

- first lazy start, once readiness succeeds
- `/serena-restart`
- cwd change via `syncProjectRoot()`
- `restart_language_server`

That means:

- before the first successful startup, `startCfg.port` is provisional and may be replaced by retry logic if a port race is detected
- after the first successful startup, `startCfg.port` becomes the session source of truth
- `serverMgr.restart(newProjectRoot)` must preserve the existing stable port
- any extension-level restart path must reuse `startCfg.port`
- after the first successful startup, the stable session port must never change; if a later restart on that stable port fails, surface a hard error instead of allocating a replacement port

### 4. Keep cwd as the only project identity

Do not add extra identity layers.

Expected behavior:

- if `_ctx.cwd === startCfg.projectRoot`, do nothing
- if `_ctx.cwd !== startCfg.projectRoot`, treat `_ctx.cwd` as a **pending rebind target** until restart/readiness succeeds
- on the next Serena tool call for a new cwd:
  - do not immediately commit the new cwd as the active project root
  - attempt to restart Serena for the new cwd on the same session port
  - only after readiness succeeds, commit the new cwd into `startCfg.projectRoot` and any other active-root session state
  - if restart/readiness fails, surface the error directly and keep the previously successful project root as the active root

This is effectively the lazy re-index behavior we want, while keeping active session state aligned with the last successfully started Serena instance.

### 5. Keep runtime state ephemeral

Do not write port, pid, or active project root to `.pi/settings.json`.

Only this remains persisted:

- `serena.mode`

Everything else remains session-local and in-memory.

### 6. Improve failure behavior

If session port allocation or Serena startup fails, surface a direct error rather than falling back silently.

Examples of acceptable failure text:

- `Serena error: could not allocate a session port`
- `Serena error: could not start for project root /path/to/repo`

The extension should prefer explicit failure over connecting to any pre-existing process.

### 6a. Define startup readiness by successful MCP connection

A spawned Serena process should not be treated as fully started just because `spawn(...)` succeeded.

Use this readiness rule instead:

- after spawn, attempt the first MCP client connection against the chosen session port
- operationally, `ensureStarted(...)` should perform readiness probing by calling `clientMgr.getClient()` only after any required `clientMgr.resetClient()` or client recreation has happened
- only treat Serena as started for the current cwd after that connection succeeds
- if the readiness connection fails because startup is still in progress, keep retrying within the normal startup timeout budget
- whenever startup or restart invalidates the currently running Serena instance, reset any cached MCP client connection before readiness probing so the check cannot accidentally succeed against a stale connection
- if readiness never succeeds, fail the startup attempt explicitly instead of leaving the session in an ambiguous `running but unusable` state

This keeps readiness aligned with the real requirement: Pi must be able to establish the MCP connection for the selected port and current project root.
### 6b. Put readiness orchestration in the extension layer

Implement readiness as an extension-level async orchestration step, for example an `ensureStarted(...)` helper in `extensions/pi-serena/index.ts`.

That helper should own this flow:

1. inspect the current `startCfg`
2. determine the desired cwd for this Serena-backed call
3. if the desired cwd differs from the active project root, treat it as a pending rebind target rather than committing it immediately
4. decide whether the current Serena/client state must be invalidated
5. if starting or restarting, call `clientMgr.resetClient()` before readiness probing
6. if a provisional-port retry changes the chosen port, recreate or reconfigure `clientMgr` so `getClient()` targets the new provisional port
7. start or restart Serena when needed
8. wait for the first successful MCP connection on the chosen session port by using `clientMgr.getClient()` as the readiness probe
9. only after readiness succeeds, commit the desired cwd as the active project root in `startCfg`
10. proceed with the actual Serena-backed tool call only after readiness succeeds

Responsibility split:

- `extensions/pi-serena/index.ts` owns session-level orchestration, cwd rebinding, retry policy, and readiness waiting
- `src/serena-server.ts` stays focused on process spawn/stop/restart and state tracking
- `src/serena-client.ts` stays focused on MCP connection and tool calls

This keeps the fix local to the integration layer and avoids pushing session policy deep into the lower-level managers.
### 7. Retry on port-race startup failures

Free-port allocation is not atomic: after the temporary listener releases the chosen port, another process could still claim it before Serena binds.

Handle that race explicitly:

- if Serena fails to start because the chosen port is no longer available, allocate a new port and retry
- on each retry, clean up the failed attempt first: stop the spawned process if present, reset cached client state, update `startCfg.port`, recreate or reconfigure `clientMgr` for the new provisional port, and only then retry
- retry up to **3 total attempts** before surfacing a hard failure
- once one startup attempt passes readiness, its port becomes the stable session port for the remainder of the Pi session
- retry only before the first successful MCP connection
- treat these as retryable startup failures:
  - the spawned Serena process exits before readiness succeeds
  - the readiness connection attempt fails with connection-refused / unreachable transport errors
  - the startup/readiness window times out before any successful MCP connection
- treat these as non-retryable failures and surface them directly:
  - MCP connection succeeds but the later real tool call fails
  - MCP responds with malformed or unexpected protocol data
  - Serena starts but returns an application/tool-level error

### 8. Add an extension-level wiring regression test

Add one focused test around `extensions/pi-serena/index.ts` that proves the integration plumbing, not just the individual helper classes.

This test should verify:

- `session_start` allocates exactly one session port
- that port is passed into both `startCfg` and `createClientManager(...)`
- the extension-level `ensureStarted(...)` flow waits for readiness before proceeding
- `/serena-restart` reuses the same stable session port once startup has succeeded
- a cwd change on the next Serena-backed tool call keeps the same stable session port and updates the active project root only after restart/readiness succeeds
- if a later restart on the stable session port fails, the error is surfaced directly, the port is not changed, and the previously successful project root remains active

## Test plan

### A. Port allocation plumbing

Add tests that verify:

- a session can start with a non-default assigned port
- the client manager uses the same chosen port
- the server manager command includes the chosen port
- a startup attempt is only considered ready after the first successful MCP connection
- retry happens only before the first successful MCP connection and only for the defined retryable startup failures

### B. Port stability across lifecycle events

Add tests that verify the same stable session port is preserved across:

- `serverMgr.restart(newProjectRoot)`
- `syncProjectRoot()` when the cwd changes
- extension restart flows such as `/serena-restart`
- the initial status/reporting path before the first lazy Serena start
- later restart failures on the stable port, which must fail without silently changing ports

### C. Cwd rebinding behavior

Keep or expand tests showing:

- no restart when cwd is unchanged
- restart when cwd changes and the server is running
- no restart when cwd changes and the server is stopped
- the active project root is committed only after restart/readiness succeeds
- if cwd rebind restart fails, the previously successful project root remains active
- in all of those cases, the port remains unchanged

### D. Regression coverage for the original bug

Add a focused test that models two logical sessions with different ports and verifies they do not share the same endpoint assumptions.

This test does not need to spin up real Serena processes; mocked client/server plumbing is enough.

### E. Extension wiring coverage

Add a focused extension test that verifies:

- before first use, `/serena-status` merges session state with live server state and reports `Server: not used yet`
- before first use, `/serena-status` reports `root` from `startCfg.projectRoot` and the provisional session port from `startCfg.port`
- `session_start` does not fall back to `DEFAULT_PORT` in normal runtime operation
- the extension-level `ensureStarted(...)` orchestration performs readiness waiting before the first real Serena tool call
- readiness probing uses `clientMgr.getClient()` only after stale client state has been reset
- restart/readiness paths reset stale client connections before probing readiness
- if initial startup has to retry with a new provisional port, `clientMgr` is recreated or reconfigured for that port and status/in-memory state are updated to the winning port
- the same stable session port survives `/serena-restart` and lazy cwd rebinding after startup succeeds
- lazy cwd rebinding commits the new active project root only after readiness succeeds
- later restart failure on the stable port surfaces an error, does not allocate a replacement port, and leaves the previous active project root unchanged

## README updates

Update `README.md` to reflect the real runtime behavior:

- Serena uses a **session-unique local port**, not a single shared fixed port
- cwd changes are handled lazily on the next Serena tool call
- the active project root is rebound by restarting Serena for the new cwd
- `.pi/settings.json` persists mode, not runtime port state

Also update any text that currently implies `DEFAULT_PORT = 40000` is the normal runtime port for all sessions.

## Suggested execution order

1. Add the failing tests for session-specific port behavior.
2. Implement port allocation and session-start plumbing.
3. Implement extension-level `ensureStarted(...)` orchestration with readiness waiting.
4. Update restart/rebind flows to preserve the chosen session port.
5. Update README text.
6. Run the full test suite.

## Acceptance criteria

- Two simultaneous Pi sessions cannot accidentally share the same Serena port by default.
- After the first successful startup, a Pi session keeps one stable Serena port for its lifetime.
- A cwd change keeps the same port and lazily restarts Serena for the new project root.
- The active project root changes only after restart/readiness succeeds; failed rebinding leaves the previous active project root unchanged.
- Before first use, `/serena-status` reports `Server: not used yet`, plus the current provisional session port from `startCfg.port` and current project root from `startCfg.projectRoot`.
- Startup is only considered successful after the first MCP client connection succeeds for the chosen session port.
- Readiness waiting is orchestrated in the extension layer, not buried implicitly in a lower-level helper.
- Startup handles the free-port race by cleaning up the failed attempt, retrying with a newly allocated provisional port, recreating or reconfiguring `clientMgr` for that port, and updating in-memory state/status to the winning port, up to 3 total attempts.
- Retry is limited to pre-readiness startup failures: child exit before readiness, connection-refused/unreachable readiness errors, or startup timeout before first successful MCP connection.
- Readiness probing uses `clientMgr.getClient()` after any required client reset or client recreation.
- After the first successful startup, the stable session port never changes; later restart failures surface directly and do not allocate a replacement port.
- Post-connect failures are surfaced directly and are not retried as port-race startup issues.
- No runtime port state is written to `.pi/settings.json`.
- Tests cover the new port behavior and the original collision class of bug.

## Verification

Run from `items-created/pi-serena`:

```bash
npm test
```

Optional manual verification:

1. Start two Pi sessions in two different repos with `pi-serena` loaded.
2. In each session, run `/serena-status`.
3. Confirm the reported ports differ.
4. In one session, `cd` to another repo and run a Serena-backed tool.
5. Confirm `/serena-status` shows the same port and, after successful rebind, the new project root.
```