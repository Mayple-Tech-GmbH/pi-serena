import type { SerenaMode } from "./modes.ts";
import { isValidMode, modeDefaults } from "./modes.ts";

export type SerenaConfig = {
  mode: SerenaMode;
  serenaContext: string;
  rawLspEnabled: boolean;
  serenaSemanticToolsOnly: boolean;
  pinStrategy: string;
  keepInstalledLspPackage: boolean;
};

/** Extension-local defaults — applied before any project override. */
export const EXTENSION_DEFAULTS: SerenaConfig = Object.freeze({
  mode: "replace-lsp",
  serenaContext: "ide",
  rawLspEnabled: false,
  serenaSemanticToolsOnly: true,
  pinStrategy: "installed-first",
  keepInstalledLspPackage: true,
});

/**
 * Parse the raw contents of .pi/settings.json and extract the `serena` block.
 * Unknown or invalid fields are silently ignored.
 */
export function parseProjectSettings(raw: unknown): Partial<SerenaConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const serena = obj.serena;
  if (!serena || typeof serena !== "object" || Array.isArray(serena)) return {};

  const s = serena as Record<string, unknown>;
  const result: Partial<SerenaConfig> = {};

  if (isValidMode(s.mode)) result.mode = s.mode;
  if (typeof s.serenaContext === "string") result.serenaContext = s.serenaContext;
  if (typeof s.rawLspEnabled === "boolean") result.rawLspEnabled = s.rawLspEnabled;
  if (typeof s.serenaSemanticToolsOnly === "boolean") result.serenaSemanticToolsOnly = s.serenaSemanticToolsOnly;
  if (typeof s.pinStrategy === "string") result.pinStrategy = s.pinStrategy;
  if (typeof s.keepInstalledLspPackage === "boolean") result.keepInstalledLspPackage = s.keepInstalledLspPackage;

  return result;
}

/**
 * Produce a normalized runtime config by merging extension defaults with any
 * project-level overrides.  Mode-driven fields (rawLspEnabled,
 * serenaSemanticToolsOnly) are derived from the resolved mode unless the
 * project settings explicitly set them.
 */
export function resolveConfig(projectOverrides?: Partial<SerenaConfig>): SerenaConfig {
  const overrides = projectOverrides ?? {};

  // Start from extension defaults, then apply project overrides.
  const merged: SerenaConfig = { ...EXTENSION_DEFAULTS, ...overrides };

  // For mode-driven fields, apply mode defaults only if the project did not
  // explicitly provide a value.
  const modeCfg = modeDefaults(merged.mode);
  if (overrides.rawLspEnabled === undefined) {
    merged.rawLspEnabled = modeCfg.rawLspEnabled;
  }
  if (overrides.serenaSemanticToolsOnly === undefined) {
    merged.serenaSemanticToolsOnly = modeCfg.serenaSemanticToolsOnly;
  }

  return merged;
}
