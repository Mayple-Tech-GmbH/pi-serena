import test from "node:test";
import assert from "node:assert/strict";

import { SUPPORTED_MODES, isValidMode, modeDefaults } from "../src/modes.ts";

test("SUPPORTED_MODES contains exactly the three expected modes", () => {
  assert.deepEqual([...SUPPORTED_MODES].sort(), ["coexist", "maximal", "replace-lsp"]);
});

test("isValidMode returns true for all supported modes", () => {
  assert.equal(isValidMode("replace-lsp"), true);
  assert.equal(isValidMode("coexist"), true);
  assert.equal(isValidMode("maximal"), true);
});

test("isValidMode returns false for unknown values", () => {
  assert.equal(isValidMode("unknown"), false);
  assert.equal(isValidMode("lsp"), false);
  assert.equal(isValidMode(""), false);
  assert.equal(isValidMode(null), false);
  assert.equal(isValidMode(undefined), false);
  assert.equal(isValidMode(42), false);
});

test("replace-lsp disables raw lsp", () => {
  const cfg = modeDefaults("replace-lsp");
  assert.equal(cfg.rawLspEnabled, false);
});

test("coexist keeps raw lsp", () => {
  const cfg = modeDefaults("coexist");
  assert.equal(cfg.rawLspEnabled, true);
});

test("maximal exposes broader Serena tools", () => {
  const cfg = modeDefaults("maximal");
  assert.equal(cfg.serenaSemanticToolsOnly, false);
});

test("replace-lsp uses semantic-tools-only", () => {
  const cfg = modeDefaults("replace-lsp");
  assert.equal(cfg.serenaSemanticToolsOnly, true);
});

test("coexist uses semantic-tools-only", () => {
  const cfg = modeDefaults("coexist");
  assert.equal(cfg.serenaSemanticToolsOnly, true);
});

test("maximal disables raw lsp", () => {
  const cfg = modeDefaults("maximal");
  assert.equal(cfg.rawLspEnabled, false);
});
