import { createServer } from "node:net";

/** Ask the OS for a free localhost TCP port for this Pi session. */
export async function allocateSessionPort(host = "127.0.0.1"): Promise<number> {
  const server = createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("could not determine allocated port");
    }

    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }).catch(() => {
      // Best-effort close; the caller only cares about the allocated port or thrown error.
    });
  }
}
