import test from "node:test";
import assert from "node:assert/strict";

import { shapeResult, MAX_RESULT_BYTES } from "../src/results.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextResult(...texts: string[]) {
  return {
    content: texts.map((text) => ({ type: "text", text })),
  };
}

function makeImageResult() {
  return {
    content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
  };
}

function makeErrorResult(text: string) {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Basic text preservation
// ---------------------------------------------------------------------------

test("shapeResult preserves single text content item", () => {
  const result = makeTextResult("Hello from Serena");
  const shaped = shapeResult(result);
  assert.ok(shaped.includes("Hello from Serena"), `Expected text in output, got: ${shaped}`);
});

test("shapeResult joins multiple text content items", () => {
  const result = makeTextResult("First chunk", "Second chunk");
  const shaped = shapeResult(result);
  assert.ok(shaped.includes("First chunk"), "Expected first chunk");
  assert.ok(shaped.includes("Second chunk"), "Expected second chunk");
});

test("shapeResult returns empty string for empty content array", () => {
  const result = { content: [] };
  const shaped = shapeResult(result);
  assert.equal(shaped, "");
});

// ---------------------------------------------------------------------------
// Non-text payloads
// ---------------------------------------------------------------------------

test("shapeResult ignores non-text content items", () => {
  const result = makeImageResult();
  const shaped = shapeResult(result);
  // Should return empty string, not crash
  assert.equal(shaped, "");
});

test("shapeResult handles mixed text and image content", () => {
  const result = {
    content: [
      { type: "text", text: "description" },
      { type: "image", data: "base64", mimeType: "image/png" },
    ],
  };
  const shaped = shapeResult(result);
  assert.ok(shaped.includes("description"), "Expected text to be preserved");
  assert.ok(!shaped.includes("base64"), "Image data should be dropped");
});

test("shapeResult returns empty string for null/undefined result", () => {
  assert.equal(shapeResult(null), "");
  assert.equal(shapeResult(undefined), "");
});

test("shapeResult returns empty string when content property is missing", () => {
  assert.equal(shapeResult({}), "");
});

// ---------------------------------------------------------------------------
// Error result passthrough
// ---------------------------------------------------------------------------

test("shapeResult returns text from isError results without extra wrapping", () => {
  const result = makeErrorResult("Tool not found");
  const shaped = shapeResult(result);
  assert.ok(shaped.includes("Tool not found"), `Got: ${shaped}`);
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

test("MAX_RESULT_BYTES is defined and positive", () => {
  assert.ok(typeof MAX_RESULT_BYTES === "number" && MAX_RESULT_BYTES > 0);
});

test("shapeResult does not truncate result within limit", () => {
  const text = "a".repeat(100);
  const result = makeTextResult(text);
  const shaped = shapeResult(result);
  assert.ok(shaped.includes(text), "Short text should pass through untruncated");
});

test("shapeResult truncates result that exceeds MAX_RESULT_BYTES", () => {
  const text = "x".repeat(MAX_RESULT_BYTES + 1000);
  const result = makeTextResult(text);
  const shaped = shapeResult(result);
  assert.ok(
    shaped.length <= MAX_RESULT_BYTES + 200,
    `Truncated output should be near MAX_RESULT_BYTES, got length ${shaped.length}`,
  );
});

test("shapeResult appends a truncation notice when truncated", () => {
  const text = "z".repeat(MAX_RESULT_BYTES + 1000);
  const result = makeTextResult(text);
  const shaped = shapeResult(result);
  // Notice should mention truncation (Pi-like convention)
  const hasNotice = /truncat|omit|limit/i.test(shaped);
  assert.ok(hasNotice, `Expected truncation notice in: ${shaped.slice(-200)}`);
});

test("shapeResult does not append truncation notice for short output", () => {
  const text = "short output";
  const result = makeTextResult(text);
  const shaped = shapeResult(result);
  const hasNotice = /truncat|omit|limit/i.test(shaped);
  assert.ok(!hasNotice, `Unexpected truncation notice in: ${shaped}`);
});
