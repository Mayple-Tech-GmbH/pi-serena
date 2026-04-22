import type { SerenaClientManager } from "./serena-client.ts";
import type { SerenaServerManager, StartConfig } from "./serena-server.ts";

type ServerLike = Pick<SerenaServerManager, "getState" | "restart">;
type ClientLike = Pick<SerenaClientManager, "setProjectRoot">;

/**
 * Keep the cached Serena project root aligned with Pi's current cwd.
 *
 * If Serena has already been started for a different root, restart it so
 * follow-up semantic tool calls run against the active project.
 */
export function syncProjectRoot(
  cwd: string,
  startCfg: StartConfig,
  serverMgr: ServerLike,
  clientMgr: ClientLike,
): StartConfig {
  if (!cwd || cwd === startCfg.projectRoot) return startCfg;

  clientMgr.setProjectRoot(cwd);

  const state = serverMgr.getState();
  if (state.projectRoot !== cwd && state.processState !== "stopped") {
    serverMgr.restart(cwd);
  }

  // The extension now commits the new active project root only after
  // readiness succeeds, so this helper leaves the active config unchanged.
  return startCfg;
}
