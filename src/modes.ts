export type SerenaMode = "replace-lsp" | "coexist" | "maximal";

export const SUPPORTED_MODES: readonly SerenaMode[] = ["replace-lsp", "coexist", "maximal"] as const;

export function isValidMode(value: unknown): value is SerenaMode {
  return typeof value === "string" && (SUPPORTED_MODES as readonly string[]).includes(value);
}

export type ModeConfig = {
  rawLspEnabled: boolean;
  serenaSemanticToolsOnly: boolean;
};

/**
 * Returns the mode-driven defaults for rawLspEnabled and serenaSemanticToolsOnly.
 * - replace-lsp: disables raw lsp, semantic-tools-only
 * - coexist: keeps raw lsp, semantic-tools-only
 * - maximal: disables raw lsp, exposes broader Serena tools
 */
export function modeDefaults(mode: SerenaMode): ModeConfig {
  switch (mode) {
    case "replace-lsp":
      return { rawLspEnabled: false, serenaSemanticToolsOnly: true };
    case "coexist":
      return { rawLspEnabled: true, serenaSemanticToolsOnly: true };
    case "maximal":
      return { rawLspEnabled: false, serenaSemanticToolsOnly: false };
  }
}
