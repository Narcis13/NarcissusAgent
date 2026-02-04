#!/usr/bin/env bun
/**
 * Claude Code Orchestrator (CCO) - CLI Entry Point
 *
 * Integrates PTYManager, SessionManager, HooksController, and Bun web server into
 * a working CLI application. Spawns Claude Code with a task description and
 * streams output while receiving deterministic events via hooks.
 */

import { parseArgs } from "util";
import { appendFileSync, writeFileSync } from "node:fs";
import { PTYManager } from "./pty";
import { sessionManager } from "./session";
import { createServer, setHooksController, setClaudeLauncher, setDecoupledMode, initializeBroadcaster } from "./server";
import { HooksController } from "./hooks";
import { eventBroadcaster } from "./websocket";
import { createMockSupervisor } from "./supervisor";

// Parse CLI arguments
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "13013" },
    decouple: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
    verbose: { type: "boolean", short: "v", default: false },
    debug: { type: "boolean", short: "d", default: false },
    "debug-file": { type: "string" },
    "debug-file-only": { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: true,
});

// Debug logging utility
const debugMode = values.debug ?? false;
const debugFile = values["debug-file"];
const debugFileOnly = values["debug-file-only"] ?? false;

// Clear debug file at start if specified
if (debugFile) {
  writeFileSync(debugFile, `[CCO] Debug log started at ${new Date().toISOString()}\n`);
}

function debugLog(message: string, data?: unknown) {
  if (!debugMode && !(values.verbose ?? false)) return;

  const timestamp = new Date().toISOString().split("T")[1]?.slice(0, -1) ?? "";
  const line = data
    ? `[CCO ${timestamp}] ${message} ${JSON.stringify(data)}`
    : `[CCO ${timestamp}] ${message}`;

  if (debugFile) {
    appendFileSync(debugFile, line + "\n");
  }

  // Only print to stderr if not file-only mode
  if (!debugFileOnly) {
    console.error(line);
  }
}

// Show help
if (values.help) {
  console.log(`
Claude Code Orchestrator (CCO)

Usage: cco [task description] [options]

Options:
  --port <number>       Server port (default: 13013)
  --decouple            Start server without launching Claude (launch from UI)
  -v, --verbose         Show hook events as they arrive
  -d, --debug           Show ALL debug output (hooks, decisions)
  --debug-file <path>   Write debug output to file
  --debug-file-only     Only write to file, not stderr (use with --debug-file)
  -h, --help            Show this help message

Monitor UI:
  http://localhost:<port>/monitor    Real-time monitoring dashboard

Examples:
  cco                                                  # Start interactive mode
  cco "build a hello world app"
  cco "fix the bug in auth" --port 4000
  cco --decouple                                       # Server only, launch from UI
  cco "test task" --debug                              # Debug to stderr
  cco "test task" --debug --debug-file debug.log      # Debug to both
  cco "test task" --debug --debug-file debug.log --debug-file-only  # File only
`);
  process.exit(0);
}

const taskDescription = positionals.join(" ") || "";
const port = parseInt(values.port ?? "13013", 10);
const verbose = values.verbose ?? false;
const decoupled = values.decouple ?? false;
const isInteractive = taskDescription === "";

// Log startup info in debug mode
if (debugMode) {
  debugLog("=== CCO DEBUG MODE ENABLED ===");
  debugLog("Task", taskDescription || "(interactive mode)");
  debugLog("Config", { port, verbose, debugMode, debugFile, isInteractive, decoupled });
}

// Create PTY manager
const ptyManager = new PTYManager();

// Text decoder for output
const decoder = new TextDecoder();

// Create hooks controller with event handlers
const hooksController = new HooksController({
  onStop: (event) => {
    debugLog("Stop event", {
      sessionId: event.session_id,
      transcriptPath: event.transcript_path,
    });
    eventBroadcaster.broadcastHookEvent("stop", event);
  },
  onTool: (event) => {
    debugLog("Tool event", {
      tool: event.tool_name,
      hasError: !!event.tool_response.error,
    });
    eventBroadcaster.broadcastHookEvent("tool", event);
  },
  onSessionStart: (event) => {
    debugLog("Session started", {
      sessionId: event.session_id,
      source: event.source,
    });
    eventBroadcaster.broadcastHookEvent("session-start", event);
  },
  onSessionEnd: (event) => {
    debugLog("Session ended", {
      sessionId: event.session_id,
      reason: event.reason,
    });
    eventBroadcaster.broadcastHookEvent("session-end", event);
  },
  onSupervisorCall: ({ toolHistory }) => {
    debugLog("Supervisor call", {
      toolCount: toolHistory.length,
      recentTools: toolHistory.slice(-3).map((t) => t.toolName),
    });
    eventBroadcaster.broadcastSupervisorCall(toolHistory);
  },
  onSupervisorDecision: (decision) => {
    debugLog("Supervisor decision", decision);
    eventBroadcaster.broadcastSupervisorDecision(decision);
  },
  onInject: (cmd) => {
    debugLog("Injecting command", cmd);
    eventBroadcaster.broadcastCommandInject(cmd);
  },
  onControllerStop: (reason) => {
    debugLog("Controller stopped", reason);
  },
  onError: (err) => {
    debugLog("Controller error", { message: err.message, stack: err.stack });
    eventBroadcaster.broadcastError(err);
  },
});

// Set up inject callback to write to PTY
hooksController.setOnInject((cmd) => {
  if (ptyManager.isRunning) {
    ptyManager.write(cmd + "\r");
    // Second Enter after short delay to confirm autocomplete selection and execute
    setTimeout(() => {
      if (ptyManager.isRunning) {
        ptyManager.write("\r");
      }
    }, 150);
  }
});

// Set mock supervisor for testing
hooksController.setSupervisor(createMockSupervisor({ delay: 100 }));

// Register controller with server routes
setHooksController(hooksController);

// Graceful shutdown handler
async function shutdown(signal: string) {
  // Restore stdin to normal mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  try {
    if (hooksController.isRunning()) {
      hooksController.stop(`Received ${signal}`);
    }

    await ptyManager.cleanup();
    sessionManager.setIdle();
  } catch {
    // Ignore cleanup errors during shutdown
  }

  process.exit(0);
}

// Register signal handlers
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Get actual terminal dimensions
function getTerminalSize() {
  return {
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 40,
  };
}

// Build a clean env for spawned Claude Code process.
// Remove CLAUDECODE/CLAUDE_CODE_* vars so the child doesn't think
// it's running nested inside another Claude Code session.
function buildChildEnv(): Record<string, string | undefined> {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) {
      delete childEnv[key];
    }
  }
  return childEnv;
}

// State broadcast interval reference
let stateBroadcastInterval: ReturnType<typeof setInterval> | null = null;

function startStateBroadcast() {
  if (stateBroadcastInterval) return;
  stateBroadcastInterval = setInterval(() => {
    const sessionInfo = sessionManager.getInfo();
    eventBroadcaster.broadcastSessionState({
      sessionState: sessionInfo.state,
      metadata: sessionInfo.metadata,
      controllerState: hooksController.getState(),
      stats: hooksController.getStats(),
      decoupled,
      claudeRunning: ptyManager.isRunning,
    });
  }, 1000);
}

/**
 * Spawn Claude Code as a PTY subprocess.
 * Can be called at startup (normal mode) or on demand (decouple mode).
 */
async function spawnClaude(task?: string): Promise<void> {
  if (ptyManager.isRunning) {
    throw new Error("Claude is already running");
  }

  const { cols, rows } = getTerminalSize();
  const claudeBin = `${process.env.HOME}/.claude/local/claude`;
  const command = [claudeBin, "--dangerously-skip-permissions"];
  if (task) {
    command.push(task);
  }

  sessionManager.startTask(task || "interactive session");
  startStateBroadcast();

  await ptyManager.spawn({
    command,
    cwd: process.cwd(),
    env: buildChildEnv(),
    onData: (data) => {
      process.stdout.write(decoder.decode(data));
      eventBroadcaster.broadcastPTYOutput(data);
    },
    onExit: (exitCode, signalCode) => {
      if (!decoupled && process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }

      if (hooksController.isRunning()) {
        hooksController.stop(`PTY exited with code ${exitCode}`);
      }

      sessionManager.setIdle();
      debugLog("Claude Code exited", { exitCode, signalCode });

      if (!decoupled) {
        if (stateBroadcastInterval) clearInterval(stateBroadcastInterval);
        process.exit(exitCode ?? 0);
      }
    },
    cols,
    rows,
  });

  hooksController.start(task || "interactive session");
  debugLog("Hooks controller started");

  // Forward stdin to PTY only in non-decoupled mode
  if (!decoupled && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data: Buffer) => {
      if (ptyManager.isRunning) {
        ptyManager.write(data.toString());
      }
    });
  }

  // Handle terminal resize (SIGWINCH)
  process.stdout.on("resize", () => {
    const { cols, rows } = getTerminalSize();
    ptyManager.resize(cols, rows);
  });
}

// Main function
async function main() {
  // Start HTTP server
  const server = Bun.serve(createServer(port));
  debugLog("Server running", { port, monitor: `http://localhost:${port}/monitor` });

  // Initialize broadcaster with server reference
  initializeBroadcaster(server);

  // Register decouple mode and launcher with routes
  setDecoupledMode(decoupled);
  setClaudeLauncher(spawnClaude);

  if (decoupled) {
    // Decouple mode: server only, Claude launched from UI
    console.log(`[CCO] Decoupled mode - server running at http://localhost:${port}/monitor`);
    console.log(`[CCO] Launch Claude from the monitoring UI`);
    startStateBroadcast();
    return; // Keep process alive via Bun.serve()
  }

  // Normal mode: spawn Claude immediately
  try {
    await spawnClaude(taskDescription || undefined);
  } catch (error) {
    if (stateBroadcastInterval) clearInterval(stateBroadcastInterval);
    debugLog("Failed to spawn Claude Code", { error: String(error) });
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
