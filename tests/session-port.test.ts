import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { allocateSessionPort } from "../src/session-port.ts";

test("allocateSessionPort() returns a bindable ephemeral port", async () => {
  const port = await allocateSessionPort();
  assert.equal(Number.isInteger(port), true);
  assert.ok(port > 0, `expected positive port, got ${port}`);

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});
