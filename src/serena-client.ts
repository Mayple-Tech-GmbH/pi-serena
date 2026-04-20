import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { shapeResult } from "./results.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal client interface; narrow enough to mock in tests. */
export type ClientLike = {
  connect: (transport: unknown) => Promise<void>;
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
};

/** Dependencies injected into SerenaClientManager for testability. */
export type ClientManagerDeps = {
  /** Port Serena is listening on (used to build the endpoint URL). */
  port: number;
  /** Initial project root (used for invalidation on change). */
  projectRoot: string;
  /** Factory that creates a new MCP client. */
  clientFactory: () => ClientLike;
  /** Factory that creates a transport for the given endpoint URL. */
  transportFactory: (url: URL) => unknown;
};

// ---------------------------------------------------------------------------
// Endpoint builder
// ---------------------------------------------------------------------------

/**
 * Build the Serena MCP endpoint URL.
 * Serena in streamable-http mode listens at `http://127.0.0.1:<port>/mcp`.
 */
export function buildEndpoint(port: number): URL {
  return new URL(`http://127.0.0.1:${port}/mcp`);
}

// ---------------------------------------------------------------------------
// Default factories (production wiring)
// ---------------------------------------------------------------------------

function defaultClientFactory(): ClientLike {
  return new Client({ name: "pi-serena", version: "0.1.0" });
}

function defaultTransportFactory(url: URL): unknown {
  return new StreamableHTTPClientTransport(url);
}

// ---------------------------------------------------------------------------
// Client manager
// ---------------------------------------------------------------------------

/**
 * Manages a single lazy MCP client connection to a Serena server.
 *
 * - Connects lazily on the first `getClient()` / `callSerena()` call.
 * - Reconnects transparently after `resetClient()`.
 * - Invalidates the connection when the project root changes.
 * - Wraps `callTool` with a timeout and surfaces all errors as Pi-friendly text.
 */
export class SerenaClientManager {
  private _client: ClientLike | null = null;
  private _projectRoot: string;
  private readonly _deps: ClientManagerDeps;

  constructor(deps: ClientManagerDeps) {
    this._deps = deps;
    this._projectRoot = deps.projectRoot;
  }

  /**
   * Return the connected MCP client, creating and connecting it if necessary.
   */
  async getClient(): Promise<ClientLike> {
    if (this._client !== null) return this._client;

    const client = this._deps.clientFactory();
    const url = buildEndpoint(this._deps.port);
    const transport = this._deps.transportFactory(url);
    await client.connect(transport);
    this._client = client;
    return client;
  }

  /**
   * Close the active client and clear it so the next `getClient()` reconnects.
   */
  async resetClient(): Promise<void> {
    if (this._client === null) return;
    const prev = this._client;
    this._client = null;
    try {
      await prev.close();
    } catch {
      // Best-effort close; ignore errors.
    }
  }

  /**
   * Update the project root. If it changed, the current client is invalidated
   * so the next call to `getClient()` opens a fresh connection.
   */
  setProjectRoot(root: string): void {
    if (root === this._projectRoot) return;
    this._projectRoot = root;
    // Fire-and-forget; the next getClient() will create a fresh one.
    void this.resetClient();
  }

  private async getClientWithRetry(): Promise<ClientLike> {
    let lastError: unknown;
    for (let attempt = 0; attempt < CONNECT_RETRY_COUNT; attempt++) {
      try {
        return await this.getClient();
      } catch (error) {
        lastError = error;
        if (attempt < CONNECT_RETRY_COUNT - 1) {
          await sleep(CONNECT_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError ?? new Error("unknown Serena connection failure");
  }

  /**
   * Call a Serena tool by name, returning a Pi-friendly text string.
   *
   * - Times out after `timeoutMs` milliseconds (default 10 s).
   * - Never throws; all errors are returned as readable text.
   */
  async callSerena(
    toolName: string,
    args: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<string> {
    let client: ClientLike;
    try {
      client = await this.getClientWithRetry();
    } catch (err) {
      return `Serena error: could not connect — ${errorMessage(err)}`;
    }

    const callPromise = client.callTool({ name: toolName, arguments: args });
    let timerId: ReturnType<typeof setTimeout>;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Serena tool '${toolName}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([callPromise, timeoutPromise]);
      clearTimeout(timerId!);
      return shapeResult(result);
    } catch (err) {
      clearTimeout(timerId!);
      // On timeout, reset the client so the next call opens a fresh connection.
      if (timedOut) void this.resetClient();
      return `Serena error: ${errorMessage(err)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Production-ready manager (not for tests)
// ---------------------------------------------------------------------------

/** Build a SerenaClientManager using real SDK client/transport. */
export function createClientManager(port: number, projectRoot: string): SerenaClientManager {
  return new SerenaClientManager({
    port,
    projectRoot,
    clientFactory: defaultClientFactory,
    transportFactory: defaultTransportFactory,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const CONNECT_RETRY_COUNT = 10;
const CONNECT_RETRY_DELAY_MS = 250;
