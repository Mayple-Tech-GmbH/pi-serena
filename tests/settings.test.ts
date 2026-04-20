import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readSerenaSettings, writeSerenaMode } from "../src/settings.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `pi-serena-settings-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// readSerenaSettings
// ---------------------------------------------------------------------------

test("missing .pi/settings.json defaults to replace-lsp", () => {
  const dir = makeTempDir();
  try {
    const s = readSerenaSettings(dir);
    assert.equal(s.mode, "replace-lsp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid mode in serena block defaults to replace-lsp", () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi/settings.json"),
      JSON.stringify({ serena: { mode: "not-a-real-mode" } }),
      "utf8",
    );
    const s = readSerenaSettings(dir);
    assert.equal(s.mode, "replace-lsp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSerenaSettings returns valid mode from file", () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi/settings.json"),
      JSON.stringify({ serena: { mode: "coexist" } }),
      "utf8",
    );
    const s = readSerenaSettings(dir);
    assert.equal(s.mode, "coexist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// writeSerenaMode
// ---------------------------------------------------------------------------

test("writeSerenaMode creates .pi/settings.json when absent", () => {
  const dir = makeTempDir();
  try {
    writeSerenaMode(dir, "maximal");
    const s = readSerenaSettings(dir);
    assert.equal(s.mode, "maximal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSerenaMode preserves unrelated top-level keys", () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi/settings.json"),
      JSON.stringify({ other: "value", serena: { mode: "replace-lsp" } }, null, 2) + "\n",
      "utf8",
    );
    writeSerenaMode(dir, "coexist");
    const raw = JSON.parse(readFileSync(join(dir, ".pi/settings.json"), "utf8"));
    assert.equal(raw.other, "value");
    assert.equal(raw.serena.mode, "coexist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSerenaMode preserves unrelated keys inside serena block", () => {
  const dir = makeTempDir();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi/settings.json"),
      JSON.stringify({ serena: { mode: "replace-lsp", extraKey: "keep-me" } }, null, 2) + "\n",
      "utf8",
    );
    writeSerenaMode(dir, "maximal");
    const raw = JSON.parse(readFileSync(join(dir, ".pi/settings.json"), "utf8"));
    assert.equal(raw.serena.mode, "maximal");
    assert.equal(raw.serena.extraKey, "keep-me");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
