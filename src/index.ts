#!/usr/bin/env bun
/**
 * Claude Code Orchestrator (CCO) - CLI Entry Point
 *
 * Integrates PTYManager, SessionManager, and Hono server into a working
 * CLI application. Spawns Claude Code with a task description and streams
 * output while tracking session state.
 */

import { parseArgs } from "util";
import { PTYManager } from "./pty";
import { sessionManager } from "./session";
import { createServer } from "./server";

// Parse CLI arguments
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "3000" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
  allowPositionals: true,
});

// Show help
if (values.help || positionals.length === 0) {
  console.log(`
Claude Code Orchestrator (CCO)

Usage: cco <task description> [options]

Options:
  --port <number>  Server port (default: 3000)
  -h, --help       Show this help message

Examples:
  cco "build a hello world app"
  cco "fix the bug in auth" --port 4000
`);
  process.exit(values.help ? 0 : 1);
}

const taskDescription = positionals.join(" ");
const port = parseInt(values.port ?? "3000", 10);

// Create PTY manager
const ptyManager = new PTYManager();

// Text decoder for output
const decoder = new TextDecoder();

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`\n[CCO] Received ${signal}, shutting down...`);

  try {
    await ptyManager.cleanup();
    sessionManager.setIdle();
    console.log("[CCO] Cleanup complete");
  } catch (error) {
    console.error("[CCO] Cleanup error:", error);
  }

  process.exit(0);
}

// Register signal handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Main function
async function main() {
  console.log(`[CCO] Starting Claude Code Orchestrator`);
  console.log(`[CCO] Task: ${taskDescription}`);
  console.log(`[CCO] Server: http://localhost:${port}`);
  console.log(`[CCO] Session API: http://localhost:${port}/api/session`);
  console.log("");

  // Start HTTP server
  const server = Bun.serve(createServer(port));
  console.log(`[CCO] Server running on port ${port}`);

  // Start session
  sessionManager.startTask(taskDescription);
  console.log(`[CCO] Session state: ${sessionManager.getState().status}`);
  console.log("");
  console.log("--- Claude Code Output ---");
  console.log("");

  // Spawn Claude Code with the task
  try {
    await ptyManager.spawn({
      command: ["claude", taskDescription],
      onData: (data) => {
        // Stream output to stdout (preserves ANSI colors)
        process.stdout.write(decoder.decode(data));
      },
      onExit: (exitCode, signalCode) => {
        console.log("");
        console.log("--- End Claude Code Output ---");
        console.log("");
        console.log(`[CCO] Claude Code exited with code: ${exitCode}`);
        if (signalCode) {
          console.log(`[CCO] Signal: ${signalCode}`);
        }

        // Update session state
        sessionManager.setIdle();
        console.log(`[CCO] Session state: ${sessionManager.getState().status}`);

        // Report runtime
        const metadata = sessionManager.getMetadata();
        if (metadata) {
          console.log(`[CCO] Runtime: ${formatRuntime(metadata.runtime)}`);
        }

        // Exit with Claude's exit code
        process.exit(exitCode ?? 0);
      },
      cols: 120,
      rows: 40,
    });
  } catch (error) {
    console.error("[CCO] Failed to spawn Claude Code:", error);
    sessionManager.setError(String(error));
    process.exit(1);
  }
}

function formatRuntime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Run
main().catch((error) => {
  console.error("[CCO] Fatal error:", error);
  process.exit(1);
});
