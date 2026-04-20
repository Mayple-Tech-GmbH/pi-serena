import type { SerenaMode } from "./modes.ts";

/**
 * The curated default Serena tool surface exposed in `replace-lsp` mode.
 * These are purely semantic symbol tools — no file I/O, no shell, no memory.
 *
 * `restart_language_server` is included here even though it is listed as
 * optional in the upstream Serena catalog; we expose it because the language
 * server lifecycle is integral to the replace-lsp workflow.
 */
export const DEFAULT_SEMANTIC_TOOL_NAMES: readonly string[] = [
  "find_symbol",
  "get_symbols_overview",
  "find_referencing_symbols",
  "rename_symbol",
  "replace_symbol_body",
  "insert_before_symbol",
  "insert_after_symbol",
  "restart_language_server",
];

/**
 * Broader Serena tool surface used in `maximal` mode.
 * Adds deliberate file-level tools on top of the default semantic set.
 * Shell tools and memory tools remain excluded in all modes.
 *
 * Deliberately chosen extras:
 *   - get_document              read a file's full text (LSP replacement for cat)
 *   - search_for_patterns_in_files  pattern search across the workspace (grep-like)
 *   - create_text_file          create or overwrite a file
 *   - replace_lines             raw line-range replacement
 */
export const MAXIMAL_TOOL_NAMES: readonly string[] = [
  ...DEFAULT_SEMANTIC_TOOL_NAMES,
  "search_for_pattern",
  "replace_content",
  "safe_delete_symbol",
];

/**
 * Returns the Serena tool names that should be registered for the given mode.
 *
 * - `replace-lsp` and `coexist` expose the same curated semantic set.
 * - `maximal` adds a broader set of file-level tools.
 *
 * Shell tools and memory tools are never returned regardless of mode.
 */
export function getSerenaToolNamesForMode(mode: SerenaMode): string[] {
  switch (mode) {
    case "replace-lsp":
    case "coexist":
      return [...DEFAULT_SEMANTIC_TOOL_NAMES];
    case "maximal":
      return [...MAXIMAL_TOOL_NAMES];
  }
}

/**
 * Returns true when the raw Pi `lsp` tool should remain active alongside
 * Serena tools.  Only `coexist` mode keeps both active simultaneously.
 */
export function shouldKeepRawLsp(mode: SerenaMode): boolean {
  return mode === "coexist";
}

/**
 * Returns true when Serena shell tools (e.g. `execute_shell_command`)
 * should be exposed to the model.  Always false — Pi already provides shell
 * access and we do not want duplicated, uncoordinated shell tools.
 */
export function serenaShellToolsVisible(_mode: SerenaMode): boolean {
  return false;
}

/**
 * Returns true when Serena memory tools (e.g. `create_memory`) should be
 * exposed to the model.  Always false — Pi manages its own memory layer.
 */
export function serenaMemoryToolsVisible(_mode: SerenaMode): boolean {
  return false;
}
