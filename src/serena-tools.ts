import type { SerenaMode } from "./modes.ts";
import { getSerenaToolNamesForMode } from "./tool-policy.ts";

/**
 * Lightweight wrapper metadata for a Serena MCP tool.
 * The `inputSchema` is intentionally kept minimal here — it is a passthrough
 * to the live Serena MCP server at runtime.  Extension wiring (Task 6) will
 * forward actual calls through the MCP client; these definitions serve as
 * the static registry that drives policy decisions before the server starts.
 */
export type SerenaToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Static registry of all Serena tools that pi-serena is aware of.
 * Covers the curated default set plus the extras added by `maximal` mode.
 *
 * Rules:
 *   - No shell tools (`execute_shell_command`, `execute_command`, …)
 *   - No memory tools (`create_memory`, `delete_memory`, …)
 *   - Schemas are passthrough objects; the live server provides canonical schemas.
 */
export const SERENA_TOOL_DEFINITIONS: SerenaToolDefinition[] = [
  {
    name: "find_symbol",
    description:
      "Preferred first step for exact function/class/method questions: resolve a symbol by name using the language server and return its workspace locations.",
    inputSchema: {
      type: "object",
      properties: {
        name_path_pattern: { type: "string", description: "Symbol name path pattern to search for." },
        relative_path: { type: "string", description: "Optional file or directory to scope the search to." },
        include_body: { type: "boolean", description: "Include the symbol body in the result." },
      },
      required: ["name_path_pattern"],
    },
  },
  {
    name: "get_symbols_overview",
    description:
      "Preferred way to inspect a file's semantic structure before reading large files: get a high-level overview of symbols in a file or workspace.",
    inputSchema: {
      type: "object",
      properties: {
        relative_path: { type: "string", description: "File path to inspect (relative to project root)" },
        depth: { type: "integer", description: "Optional descendant depth to include." },
      },
      required: ["relative_path"],
    },
  },
  {
    name: "find_referencing_symbols",
    description:
      "Preferred over text search for exact symbol-usage questions: find all symbols that reference the specified symbol.",
    inputSchema: {
      type: "object",
      properties: {
        name_path: { type: "string", description: "Name path of the symbol to find references for." },
        relative_path: { type: "string", description: "File containing the referenced symbol." },
      },
      required: ["name_path", "relative_path"],
    },
  },
  {
    name: "rename_symbol",
    description:
      "Preferred semantic rename for code symbols: rename a symbol across the workspace using the language server instead of text replacement.",
    inputSchema: {
      type: "object",
      properties: {
        name_path: { type: "string", description: "Name path of the symbol to rename." },
        new_name: { type: "string", description: "New symbol name" },
        relative_path: { type: "string", description: "File path where the symbol is defined" },
      },
      required: ["name_path", "relative_path", "new_name"],
    },
  },
  {
    name: "replace_symbol_body",
    description:
      "Semantic edit for changing a symbol in place: replace the entire body of a function, class, method, or similar symbol.",
    inputSchema: {
      type: "object",
      properties: {
        name_path: { type: "string", description: "Name path of the symbol to replace." },
        relative_path: { type: "string", description: "File path containing the symbol" },
        body: { type: "string", description: "New body content to replace the existing body" },
      },
      required: ["name_path", "relative_path", "body"],
    },
  },
  {
    name: "insert_before_symbol",
    description:
      "Semantic edit for symbol-scoped changes: insert code or text immediately before a named symbol.",
    inputSchema: {
      type: "object",
      properties: {
        name_path: { type: "string", description: "Name path of the symbol to insert before." },
        relative_path: { type: "string", description: "File path containing the symbol" },
        body: { type: "string", description: "Content to insert" },
      },
      required: ["name_path", "relative_path", "body"],
    },
  },
  {
    name: "insert_after_symbol",
    description:
      "Semantic edit for symbol-scoped changes: insert code or text immediately after a named symbol.",
    inputSchema: {
      type: "object",
      properties: {
        name_path: { type: "string", description: "Name path of the symbol to insert after." },
        relative_path: { type: "string", description: "File path containing the symbol" },
        body: { type: "string", description: "Content to insert" },
      },
      required: ["name_path", "relative_path", "body"],
    },
  },
  {
    name: "restart_language_server",
    description:
      "Restart Serena's language-server-backed semantic state. Use when symbol results appear stale or after large structural changes.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ---- maximal-only tools below this line ----
  {
    name: "search_for_pattern",
    description:
      "Fallback text search for literals, partial strings, logs, comments, or cases where semantic symbol lookup is not appropriate.",
    inputSchema: {
      type: "object",
      properties: {
        substring_pattern: { type: "string", description: "Regex substring pattern to search for." },
        relative_path: { type: "string", description: "Optional file or directory to scope the search to." },
        context_lines_before: { type: "integer", description: "Number of context lines before each match." },
        context_lines_after: { type: "integer", description: "Number of context lines after each match." },
      },
      required: ["substring_pattern"],
    },
  },
  {
    name: "replace_content",
    description:
      "Fallback file edit for literal or regex-matched text when a symbol-aware edit is not the right tool.",
    inputSchema: {
      type: "object",
      properties: {
        relative_path: { type: "string", description: "File path to edit, relative to the project root." },
        needle: { type: "string", description: "Literal string or regex pattern to search for." },
        repl: { type: "string", description: "Replacement text." },
        mode: { type: "string", description: 'Either "literal" or "regex".' },
        allow_multiple_occurrences: { type: "boolean", description: "Allow multiple replacements." },
      },
      required: ["relative_path", "needle", "repl", "mode"],
    },
  },
  {
    name: "safe_delete_symbol",
    description:
      "Semantic delete for removing a symbol after checking for remaining usages.",
    inputSchema: {
      type: "object",
      properties: {
        name_path_pattern: { type: "string", description: "Name path pattern of the symbol to delete." },
        relative_path: { type: "string", description: "File path containing the symbol." },
      },
      required: ["name_path_pattern", "relative_path"],
    },
  },
];

/** Index for O(1) name lookup. */
const _definitionByName = new Map<string, SerenaToolDefinition>(
  SERENA_TOOL_DEFINITIONS.map((d) => [d.name, d])
);

/**
 * Returns the subset of `SERENA_TOOL_DEFINITIONS` that the given mode allows.
 * Unknown tool names produced by the policy (i.e. names not in the static
 * registry) are silently omitted.
 */
export function getSerenaToolDefinitionsForMode(mode: SerenaMode): SerenaToolDefinition[] {
  const allowed = getSerenaToolNamesForMode(mode);
  return allowed.flatMap((name) => {
    const def = _definitionByName.get(name);
    return def ? [def] : [];
  });
}
