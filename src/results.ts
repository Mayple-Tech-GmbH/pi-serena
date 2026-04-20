// ---------------------------------------------------------------------------
// Pi-friendly result shaping for Serena MCP tool responses
// ---------------------------------------------------------------------------

/**
 * Maximum byte length of a shaped result returned to Pi.
 * Smaller than Pi's built-in 50 KB limit so this layer controls the cut-off.
 */
export const MAX_RESULT_BYTES = 50_000;

const TRUNCATION_NOTICE = "\n\n[Output truncated: result exceeded the size limit.]";

/**
 * Shape an MCP tool-call result into a plain string suitable for Pi.
 *
 * - Extracts `text` items from the `content` array.
 * - Drops non-text items (images, resources, etc.).
 * - Truncates to `MAX_RESULT_BYTES` and appends a notice.
 * - Returns `""` for null / missing content.
 */
export function shapeResult(result: unknown): string {
  if (result == null || typeof result !== "object") return "";

  const r = result as Record<string, unknown>;
  const content = r["content"];
  if (!Array.isArray(content) || content.length === 0) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (
      item != null &&
      typeof item === "object" &&
      (item as Record<string, unknown>)["type"] === "text"
    ) {
      const text = (item as Record<string, unknown>)["text"];
      if (typeof text === "string") parts.push(text);
    }
  }

  const full = parts.join("\n");
  if (full.length <= MAX_RESULT_BYTES) return full;

  return full.slice(0, MAX_RESULT_BYTES) + TRUNCATION_NOTICE;
}
