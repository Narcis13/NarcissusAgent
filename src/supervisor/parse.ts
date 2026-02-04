/**
 * Supervisor Response Parser
 *
 * Parses plain text responses with bracketed markers.
 */
import type { ParsedResponse } from "./types";

/**
 * Parse supervisor response for action markers
 *
 * Expected format:
 * - [COMPLETE] followed by summary text
 * - [ABORT] followed by reason text
 * - [CONTINUE] followed by command to inject
 *
 * If no marker found, defaults to 'continue' with warning.
 *
 * @param output - Raw supervisor output text
 * @returns ParsedResponse with action, content, and raw output
 */
export function parseResponse(output: string): ParsedResponse {
  const trimmed = output.trim();

  if (trimmed.startsWith('[COMPLETE]')) {
    return {
      action: 'complete',
      content: trimmed.slice('[COMPLETE]'.length).trim(),
      raw: output,
    };
  }

  if (trimmed.startsWith('[ABORT]')) {
    return {
      action: 'abort',
      content: trimmed.slice('[ABORT]'.length).trim(),
      raw: output,
    };
  }

  if (trimmed.startsWith('[CONTINUE]')) {
    return {
      action: 'continue',
      content: trimmed.slice('[CONTINUE]'.length).trim(),
      raw: output,
    };
  }

  // No marker found - defensive default to continue
  console.warn('[Supervisor] No marker found in response, defaulting to continue');
  return {
    action: 'continue',
    content: trimmed,
    raw: output,
  };
}
