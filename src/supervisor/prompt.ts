/**
 * Supervisor Prompt Builder
 *
 * Constructs context-rich prompts for supervisor decisions.
 * Reads the worker's transcript JSONL to provide full context.
 */

/**
 * Read and format transcript content from JSONL file
 * Extracts the conversation flow: user messages, assistant responses, tool calls
 */
export async function readTranscript(transcriptPath: string): Promise<string> {
  try {
    const file = Bun.file(transcriptPath);
    const text = await file.text();
    const lines = text.trim().split("\n").filter(line => line.length > 0);

    const formatted: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "user" && entry.message?.content) {
          const content = typeof entry.message.content === "string"
            ? entry.message.content
            : JSON.stringify(entry.message.content);
          formatted.push(`[USER] ${content.slice(0, 500)}`);
        }

        if (entry.type === "assistant" && entry.message?.content) {
          const content = entry.message.content;
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            // Extract text blocks
            const textBlocks = content
              .filter((block: { type: string }) => block.type === "text")
              .map((block: { text: string }) => block.text);
            text = textBlocks.join("\n");
          }
          if (text) {
            formatted.push(`[ASSISTANT] ${text.slice(0, 1000)}`);
          }
        }

        // Tool calls
        if (entry.type === "tool_use" || entry.tool_name) {
          const toolName = entry.tool_name || entry.name || "unknown";
          formatted.push(`[TOOL] ${toolName}`);
        }

        // Tool results
        if (entry.type === "tool_result") {
          const output = entry.content?.slice(0, 300) || "";
          const hasError = entry.is_error;
          formatted.push(`[TOOL_RESULT${hasError ? " ERROR" : ""}] ${output}`);
        }

      } catch {
        // Skip malformed lines
      }
    }

    // Return last N entries to keep prompt reasonable
    return formatted.slice(-30).join("\n\n");
  } catch (err) {
    console.error(`[buildSupervisorPrompt] Failed to read transcript: ${err}`);
    return "(failed to read transcript)";
  }
}

/**
 * Build supervisor prompt from context
 *
 * Includes:
 * - Task description
 * - Iteration count (N/M format)
 * - Full transcript from worker session
 * - Clear instructions for marker response format
 *
 * @param transcriptContent - Pre-read transcript content
 * @param taskDescription - The original task
 * @param iterationCount - Current iteration number
 * @param maxIterations - Maximum allowed iterations
 * @returns Formatted prompt string
 */
export function buildSupervisorPrompt(
  transcriptContent: string,
  taskDescription: string,
  iterationCount: number,
  maxIterations: number
): string {
  return `You are supervising a Claude Code instance (the "worker") that is working on a task.
Your job is to review what the worker has done and decide what happens next.

TASK: ${taskDescription}

ITERATION: ${iterationCount}/${maxIterations}

=== WORKER SESSION TRANSCRIPT ===
${transcriptContent}
=== END TRANSCRIPT ===

Based on this transcript, decide the next action:

- If the work is COMPLETE (task accomplished, no more work needed):
  Respond with [COMPLETE] followed by a brief summary.

- If something is WRONG and we should STOP (errors, wrong direction, stuck in loop):
  Respond with [ABORT] followed by the reason.

- If work should CONTINUE (more steps needed):
  Respond with [CONTINUE] followed by the EXACT instruction to give the worker.
  Be specific and actionable. The worker will receive your instruction verbatim.

Respond with ONLY the marker and your content. No additional explanation.

Example responses:
[COMPLETE] Successfully implemented the authentication flow with JWT tokens.
[ABORT] Worker is stuck in a loop creating the same file repeatedly.
[CONTINUE] Now write unit tests for the auth module in tests/auth.test.ts`;
}
