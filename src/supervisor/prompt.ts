/**
 * Supervisor Prompt Builder
 *
 * Constructs context-rich prompts for supervisor decisions.
 */
import type { SupervisorContext } from "./types";

/**
 * Build supervisor prompt from context
 *
 * Includes:
 * - Task description
 * - Iteration count (N/M format)
 * - Recent tool history (last 10, truncated)
 * - Clear instructions for marker response format
 *
 * NOTE: iterationCount and maxIterations are passed as direct parameters
 * rather than from SupervisorContext, since they're tracked in the
 * createClaudeSupervisor closure (not part of HooksController's context).
 *
 * @param context - SupervisorContext with task, tools, session info
 * @param iterationCount - Current iteration number (from closure)
 * @param maxIterations - Maximum allowed iterations (from closure)
 * @returns Formatted prompt string for claude -p
 */
export function buildSupervisorPrompt(
  context: SupervisorContext,
  iterationCount: number,
  maxIterations: number
): string {
  // Format tool history - last 10 entries, truncated output
  const toolSummary = context.toolHistory.slice(-10).map((t, i) => {
    const status = t.error ? `ERROR: ${t.error.slice(0, 50)}` : 'OK';
    const snippet = t.output.slice(0, 150).replace(/\n/g, ' ');
    return `[${i + 1}] ${t.toolName} (${status}): ${snippet}`;
  }).join('\n');

  return `You supervise a Claude Code instance working on a task.

TASK: ${context.taskDescription}

ITERATION: ${iterationCount}/${maxIterations}

RECENT TOOL ACTIVITY:
${toolSummary || '(no tools executed yet)'}

Based on this information, decide the next action:

- If the work is COMPLETE (task accomplished, no more work needed):
  Respond with [COMPLETE] followed by a brief summary.

- If something is WRONG and we should STOP (errors, wrong direction, stuck):
  Respond with [ABORT] followed by the reason.

- If work should CONTINUE (more steps needed):
  Respond with [CONTINUE] followed by the instruction to give the inner Claude.

Respond with ONLY the marker and content. No additional explanation.

Example responses:
[COMPLETE] Successfully implemented the authentication flow with JWT tokens.
[ABORT] Inner Claude is stuck in a loop creating the same file repeatedly.
[CONTINUE] Now write the unit tests for the auth module.`;
}
