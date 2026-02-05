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

  // Log what we're parsing
  console.log(`[parseResponse] Input (${trimmed.length} chars): "${trimmed.slice(0, 200)}"`);

  // Handle empty response
  if (!trimmed) {
    console.warn('[parseResponse] Empty response from supervisor');
    return {
      action: 'continue',
      content: '',
      raw: output,
    };
  }

  // Look for markers anywhere in the response (not just at start)
  // This handles cases where there might be leading whitespace or noise
  const completeMatch = trimmed.match(/\[COMPLETE\]\s*(.*)/s);
  if (completeMatch) {
    console.log('[parseResponse] Found COMPLETE marker');
    return {
      action: 'complete',
      content: completeMatch[1]?.trim() || '',
      raw: output,
    };
  }

  const abortMatch = trimmed.match(/\[ABORT\]\s*(.*)/s);
  if (abortMatch) {
    console.log('[parseResponse] Found ABORT marker');
    return {
      action: 'abort',
      content: abortMatch[1]?.trim() || '',
      raw: output,
    };
  }

  const continueMatch = trimmed.match(/\[CONTINUE\]\s*(.*)/s);
  if (continueMatch) {
    console.log('[parseResponse] Found CONTINUE marker');
    return {
      action: 'continue',
      content: continueMatch[1]?.trim() || '',
      raw: output,
    };
  }

  // No marker found - defensive default to continue
  console.warn(`[parseResponse] No marker found in response: "${trimmed.slice(0, 100)}"`);
  return {
    action: 'continue',
    content: trimmed,
    raw: output,
  };
}
