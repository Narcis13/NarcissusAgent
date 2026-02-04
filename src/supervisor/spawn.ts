/**
 * Supervisor Spawn
 *
 * Bun shell wrapper for spawning claude -p process.
 */
import { $ } from "bun";
import type { SpawnResult } from "./types";

const DEFAULT_TIMEOUT = 30000;

/**
 * Spawn supervisor Claude Code process with prompt
 *
 * Uses Bun.$ template literal for clean process execution.
 * - .nothrow() prevents exception on non-zero exit
 * - .quiet() suppresses stdout (we capture it)
 * - .timeout() prevents hanging
 *
 * @param prompt - The full supervisor prompt text
 * @param timeout - Timeout in ms (default: 30000)
 * @returns SpawnResult with output, exitCode, and optional error
 */
export async function spawnSupervisor(
  prompt: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<SpawnResult> {
  const claudeBin = `${process.env.HOME}/.claude/local/claude`;

  try {
    const result = await $`${claudeBin} -p ${prompt} --dangerously-skip-permissions`
      .nothrow()
      .quiet()
      .timeout(timeout);

    return {
      output: result.stdout.toString(),
      exitCode: result.exitCode,
      error: result.exitCode !== 0 ? result.stderr.toString() : undefined,
    };
  } catch (err) {
    // Timeout or other error
    return {
      output: "",
      exitCode: -1,
      error: String(err),
    };
  }
}
