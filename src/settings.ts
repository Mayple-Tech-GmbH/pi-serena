import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SerenaMode } from "./modes.ts";
import { isValidMode } from "./modes.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SerenaSettings = {
  mode: SerenaMode;
};

const DEFAULT_MODE: SerenaMode = "replace-lsp";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read the `serena` block from `<cwd>/.pi/settings.json`.
 *
 * Returns defaults when the file is absent, malformed, or the serena block is
 * missing.  Unknown keys are silently ignored.
 *
 * Settings schema (stored under the `serena` key):
 * ```json
 * {
 *   "serena": {
 *     "mode": "replace-lsp"
 *   }
 * }
 * ```
 *
 * Recognised settings:
 * - `mode`: one of `"replace-lsp"` | `"coexist"` | `"maximal"`
 *
 * Later additions (launcher strategy, raw LSP fallback, additional Serena tool
 * exposure) can be added here without breaking existing files.
 */
export function readSerenaSettings(cwd: string): SerenaSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const { serena } = raw as Record<string, unknown>;
      if (serena && typeof serena === "object" && !Array.isArray(serena)) {
        const { mode } = serena as Record<string, unknown>;
        return { mode: isValidMode(mode) ? mode : DEFAULT_MODE };
      }
    }
  } catch {
    // File missing or malformed — return defaults.
  }
  return { mode: DEFAULT_MODE };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist a new mode value into `<cwd>/.pi/settings.json`.
 *
 * Preserves all existing top-level keys and merges into the existing `serena`
 * block so that other consumers of `.pi/settings.json` are not disturbed.
 * Creates the `.pi/` directory if it does not exist.
 */
export function writeSerenaMode(cwd: string, mode: SerenaMode): void {
  const filePath = join(cwd, ".pi/settings.json");

  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // File absent or unparseable — start from an empty object.
  }

  // Merge into the existing serena block so unrelated serena keys are kept.
  const prevSerena =
    existing.serena && typeof existing.serena === "object" && !Array.isArray(existing.serena)
      ? (existing.serena as Record<string, unknown>)
      : {};

  existing.serena = { ...prevSerena, mode };

  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
}
