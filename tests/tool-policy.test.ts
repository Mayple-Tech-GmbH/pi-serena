import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SEMANTIC_TOOL_NAMES,
  MAXIMAL_TOOL_NAMES,
  getSerenaToolNamesForMode,
  shouldKeepRawLsp,
  serenaShellToolsVisible,
  serenaMemoryToolsVisible,
} from "../src/tool-policy.ts";

import {
  SERENA_TOOL_DEFINITIONS,
  getSerenaToolDefinitionsForMode,
} from "../src/serena-tools.ts";

// ---------------------------------------------------------------------------
// Step 1: Default tool selection (replace-lsp)
// ---------------------------------------------------------------------------

const EXPECTED_DEFAULT_TOOLS = [
  "find_symbol",
  "get_symbols_overview",
  "find_referencing_symbols",
  "rename_symbol",
  "replace_symbol_body",
  "insert_before_symbol",
  "insert_after_symbol",
  "restart_language_server",
] as const;

test("DEFAULT_SEMANTIC_TOOL_NAMES contains exactly the curated 8 tools", () => {
  assert.deepEqual(
    [...DEFAULT_SEMANTIC_TOOL_NAMES].sort(),
    [...EXPECTED_DEFAULT_TOOLS].sort()
  );
});

test("getSerenaToolNamesForMode(replace-lsp) returns exactly the 8 curated tools", () => {
  const names = getSerenaToolNamesForMode("replace-lsp");
  assert.deepEqual([...names].sort(), [...EXPECTED_DEFAULT_TOOLS].sort());
});

test("replace-lsp does not include shell tools", () => {
  const names = getSerenaToolNamesForMode("replace-lsp");
  assert.ok(!names.includes("execute_shell_command"), "shell tool must not appear");
  assert.ok(!names.includes("execute_command"), "shell tool must not appear");
});

test("replace-lsp does not include memory tools", () => {
  const names = getSerenaToolNamesForMode("replace-lsp");
  assert.ok(!names.includes("create_memory"), "memory tool must not appear");
  assert.ok(!names.includes("delete_memory"), "memory tool must not appear");
});

// ---------------------------------------------------------------------------
// Step 2: Mode-specific policy
// ---------------------------------------------------------------------------

test("shouldKeepRawLsp(replace-lsp) returns false", () => {
  assert.equal(shouldKeepRawLsp("replace-lsp"), false);
});

test("shouldKeepRawLsp(coexist) returns true", () => {
  assert.equal(shouldKeepRawLsp("coexist"), true);
});

test("shouldKeepRawLsp(maximal) returns false", () => {
  assert.equal(shouldKeepRawLsp("maximal"), false);
});

test("coexist exposes the same semantic tools as replace-lsp", () => {
  const replaceLsp = getSerenaToolNamesForMode("replace-lsp");
  const coexist = getSerenaToolNamesForMode("coexist");
  assert.deepEqual([...coexist].sort(), [...replaceLsp].sort());
});

test("maximal exposes a broader tool set than replace-lsp", () => {
  const replaceLsp = getSerenaToolNamesForMode("replace-lsp");
  const maximal = getSerenaToolNamesForMode("maximal");
  // maximal must be a strict superset
  assert.ok(
    maximal.length > replaceLsp.length,
    `maximal (${maximal.length}) must expose more tools than replace-lsp (${replaceLsp.length})`
  );
  // all replace-lsp tools must also be in maximal
  for (const name of replaceLsp) {
    assert.ok(maximal.includes(name), `${name} must appear in maximal`);
  }
});

test("maximal does not include shell tools", () => {
  const names = getSerenaToolNamesForMode("maximal");
  assert.ok(!names.includes("execute_shell_command"), "shell tool must not appear in maximal");
  assert.ok(!names.includes("execute_command"), "shell tool must not appear in maximal");
});

test("maximal does not include memory tools", () => {
  const names = getSerenaToolNamesForMode("maximal");
  assert.ok(!names.includes("create_memory"), "memory tool must not appear in maximal");
  assert.ok(!names.includes("delete_memory"), "memory tool must not appear in maximal");
});

// ---------------------------------------------------------------------------
// Category visibility helpers
// ---------------------------------------------------------------------------

test("serenaShellToolsVisible returns false for all modes", () => {
  assert.equal(serenaShellToolsVisible("replace-lsp"), false);
  assert.equal(serenaShellToolsVisible("coexist"), false);
  assert.equal(serenaShellToolsVisible("maximal"), false);
});

test("serenaMemoryToolsVisible returns false for all modes", () => {
  assert.equal(serenaMemoryToolsVisible("replace-lsp"), false);
  assert.equal(serenaMemoryToolsVisible("coexist"), false);
  assert.equal(serenaMemoryToolsVisible("maximal"), false);
});

// ---------------------------------------------------------------------------
// MAXIMAL_TOOL_NAMES constant
// ---------------------------------------------------------------------------

test("MAXIMAL_TOOL_NAMES is a strict superset of DEFAULT_SEMANTIC_TOOL_NAMES", () => {
  for (const name of DEFAULT_SEMANTIC_TOOL_NAMES) {
    assert.ok(
      MAXIMAL_TOOL_NAMES.includes(name),
      `${name} must be present in MAXIMAL_TOOL_NAMES`
    );
  }
  assert.ok(
    MAXIMAL_TOOL_NAMES.length > DEFAULT_SEMANTIC_TOOL_NAMES.length,
    "MAXIMAL_TOOL_NAMES must be strictly larger"
  );
});

// ---------------------------------------------------------------------------
// serena-tools.ts wrapper selection
// ---------------------------------------------------------------------------

test("SERENA_TOOL_DEFINITIONS covers at least the curated 8 tools", () => {
  const definedNames = SERENA_TOOL_DEFINITIONS.map((d) => d.name);
  for (const name of EXPECTED_DEFAULT_TOOLS) {
    assert.ok(definedNames.includes(name), `definition missing for ${name}`);
  }
});

test("each tool definition has name, description, and inputSchema", () => {
  for (const def of SERENA_TOOL_DEFINITIONS) {
    assert.ok(typeof def.name === "string" && def.name.length > 0, `name must be non-empty string`);
    assert.ok(typeof def.description === "string" && def.description.length > 0, `description required for ${def.name}`);
    assert.ok(def.inputSchema !== null && typeof def.inputSchema === "object", `inputSchema must be object for ${def.name}`);
  }
});

test("getSerenaToolDefinitionsForMode(replace-lsp) returns exactly 8 definitions", () => {
  const defs = getSerenaToolDefinitionsForMode("replace-lsp");
  assert.equal(defs.length, EXPECTED_DEFAULT_TOOLS.length);
});

test("getSerenaToolDefinitionsForMode(replace-lsp) names match curated list", () => {
  const defs = getSerenaToolDefinitionsForMode("replace-lsp");
  const names = defs.map((d) => d.name);
  assert.deepEqual(names.sort(), [...EXPECTED_DEFAULT_TOOLS].sort());
});

test("getSerenaToolDefinitionsForMode(coexist) returns same tools as replace-lsp", () => {
  const replaceLsp = getSerenaToolDefinitionsForMode("replace-lsp").map((d) => d.name).sort();
  const coexist = getSerenaToolDefinitionsForMode("coexist").map((d) => d.name).sort();
  assert.deepEqual(coexist, replaceLsp);
});

test("getSerenaToolDefinitionsForMode(maximal) returns more tools than replace-lsp", () => {
  const replaceLsp = getSerenaToolDefinitionsForMode("replace-lsp");
  const maximal = getSerenaToolDefinitionsForMode("maximal");
  assert.ok(maximal.length > replaceLsp.length);
});
