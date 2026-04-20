import test from "node:test";
import assert from "node:assert/strict";

import { resolveConfig, parseProjectSettings, EXTENSION_DEFAULTS } from "../src/config.ts";

test("default resolved config has mode = replace-lsp", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.mode, "replace-lsp");
});

test("default resolved config has serenaContext = ide", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.serenaContext, "ide");
});

test("default resolved config has rawLspEnabled = false", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.rawLspEnabled, false);
});

test("default resolved config has serenaSemanticToolsOnly = true", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.serenaSemanticToolsOnly, true);
});

test("default resolved config has pinStrategy = installed-first", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.pinStrategy, "installed-first");
});

test("default resolved config has keepInstalledLspPackage = true", () => {
  const cfg = resolveConfig();
  assert.equal(cfg.keepInstalledLspPackage, true);
});

test("EXTENSION_DEFAULTS matches expected defaults", () => {
  assert.equal(EXTENSION_DEFAULTS.mode, "replace-lsp");
  assert.equal(EXTENSION_DEFAULTS.serenaContext, "ide");
  assert.equal(EXTENSION_DEFAULTS.rawLspEnabled, false);
  assert.equal(EXTENSION_DEFAULTS.serenaSemanticToolsOnly, true);
  assert.equal(EXTENSION_DEFAULTS.pinStrategy, "installed-first");
  assert.equal(EXTENSION_DEFAULTS.keepInstalledLspPackage, true);
});

test("resolveConfig with coexist mode enables rawLspEnabled", () => {
  const cfg = resolveConfig({ mode: "coexist" });
  assert.equal(cfg.mode, "coexist");
  assert.equal(cfg.rawLspEnabled, true);
});

test("resolveConfig with maximal mode disables serenaSemanticToolsOnly", () => {
  const cfg = resolveConfig({ mode: "maximal" });
  assert.equal(cfg.mode, "maximal");
  assert.equal(cfg.serenaSemanticToolsOnly, false);
});

test("resolveConfig overrides individual fields", () => {
  const cfg = resolveConfig({ pinStrategy: "latest", keepInstalledLspPackage: false });
  assert.equal(cfg.pinStrategy, "latest");
  assert.equal(cfg.keepInstalledLspPackage, false);
  // defaults still apply for unset fields
  assert.equal(cfg.mode, "replace-lsp");
});

test("parseProjectSettings extracts serena block from raw settings", () => {
  const raw = { serena: { mode: "coexist" } };
  const result = parseProjectSettings(raw);
  assert.equal(result.mode, "coexist");
});

test("parseProjectSettings ignores unknown mode", () => {
  const raw = { serena: { mode: "invalid-mode" } };
  const result = parseProjectSettings(raw);
  assert.equal(result.mode, undefined);
});

test("parseProjectSettings returns empty object for missing serena block", () => {
  assert.deepEqual(parseProjectSettings({}), {});
  assert.deepEqual(parseProjectSettings(null), {});
  assert.deepEqual(parseProjectSettings(undefined), {});
});

test("parseProjectSettings extracts all known fields", () => {
  const raw = {
    serena: {
      mode: "maximal",
      serenaContext: "terminal",
      rawLspEnabled: true,
      serenaSemanticToolsOnly: false,
      pinStrategy: "latest",
      keepInstalledLspPackage: false,
    },
  };
  const result = parseProjectSettings(raw);
  assert.equal(result.mode, "maximal");
  assert.equal(result.serenaContext, "terminal");
  assert.equal(result.rawLspEnabled, true);
  assert.equal(result.serenaSemanticToolsOnly, false);
  assert.equal(result.pinStrategy, "latest");
  assert.equal(result.keepInstalledLspPackage, false);
});
test("EXTENSION_DEFAULTS is frozen (importers cannot mutate shared defaults)", () => {
  assert.equal(Object.isFrozen(EXTENSION_DEFAULTS), true);
});

test("explicit rawLspEnabled false survives coexist mode-derived default", () => {
  const cfg = resolveConfig({ mode: "coexist", rawLspEnabled: false });
  assert.equal(cfg.rawLspEnabled, false);
});

test("parseProjectSettings -> resolveConfig pipeline: maximal mode produces serenaSemanticToolsOnly false", () => {
  const parsed = parseProjectSettings({ serena: { mode: "maximal" } });
  const cfg = resolveConfig(parsed);
  assert.equal(cfg.mode, "maximal");
  assert.equal(cfg.serenaSemanticToolsOnly, false);
});
