/**
 * Hono REST API Routes
 *
 * Provides HTTP endpoints for session status, health checks, and hook events.
 * CORS enabled for Phase 4 web UI integration.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionManager } from "../session";
import type { HooksController } from "../hooks";
import type {
  StopEvent,
  ToolEvent,
  SessionStartEvent,
  SessionEndEvent,
} from "../hooks";

// Hooks controller reference - set via setHooksController
let hooksController: HooksController | null = null;

// Decouple mode state
let isDecoupled = false;
let claudeLauncher: ((task?: string) => Promise<void>) | null = null;

// Supervisor stop hook callback
let supervisorStopCallback: ((event: { session_id: string; transcript_path: string }) => void) | null = null;

/**
 * Set callback for supervisor stop hook
 */
export function setSupervisorStopCallback(
  callback: ((event: { session_id: string; transcript_path: string }) => void) | null
): void {
  supervisorStopCallback = callback;
}

/**
 * Set the hooks controller for API endpoints
 */
export function setHooksController(controller: HooksController): void {
  hooksController = controller;
}

/**
 * Set the Claude launcher function (used in decouple mode)
 */
export function setClaudeLauncher(launcher: (task?: string) => Promise<void>): void {
  claudeLauncher = launcher;
}

/**
 * Set whether running in decoupled mode
 */
export function setDecoupledMode(decoupled: boolean): void {
  isDecoupled = decoupled;
}

const app = new Hono();

// Enable CORS for web UI (Phase 4)
app.use("/api/*", cors());

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Session info endpoint (SES-03)
app.get("/api/session", (c) => {
  const info = sessionManager.getInfo();
  const controllerStats = hooksController?.getStats();

  return c.json({
    state: info.state.status,
    stateDetails: info.state,
    metadata: info.metadata
      ? {
          taskDescription: info.metadata.taskDescription,
          startTime: info.metadata.startTime.toISOString(),
          runtime: info.metadata.runtime,
          runtimeFormatted: formatRuntime(info.metadata.runtime),
        }
      : null,
    hooks: controllerStats
      ? {
          state: hooksController?.getState(),
          stats: controllerStats,
        }
      : null,
  });
});

// ============ Claude Launch (Decouple Mode) ============

/**
 * POST /api/claude/launch - Launch Claude subprocess (decouple mode only)
 * Body: { task?: string }
 */
app.post("/api/claude/launch", async (c) => {
  if (!isDecoupled) {
    return c.json({ error: "Not in decoupled mode" }, 400);
  }
  if (!claudeLauncher) {
    return c.json({ error: "Launcher not initialized" }, 503);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const task = (body as { task?: string }).task || undefined;
    await claudeLauncher(task);
    return c.json({ ok: true, task: task || "interactive session" });
  } catch (error) {
    return c.json({ error: String(error) }, 409);
  }
});

// ============ Control Endpoints ============

/**
 * POST /api/control/inject - Manually inject a command
 * Body: { command: string }
 */
app.post("/api/control/inject", async (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const command = (body as { command?: string }).command;
    if (!command) {
      return c.json({ error: "Command required" }, 400);
    }
    hooksController.injectCommand(command);
    return c.json({ ok: true, command });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * POST /api/control/pause - Pause the monitoring loop
 */
app.post("/api/control/pause", (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }
  hooksController.pause();
  return c.json({ ok: true, paused: true });
});

/**
 * POST /api/control/resume - Resume the monitoring loop
 */
app.post("/api/control/resume", (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }
  hooksController.resume();
  return c.json({ ok: true, paused: false });
});

/**
 * POST /api/control/stop - Force stop the controller
 */
app.post("/api/control/stop", (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }
  hooksController.stop("Manual stop from UI");
  return c.json({ ok: true });
});

/**
 * GET /api/control/status - Get controller status including paused state
 */
app.get("/api/control/status", (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }
  return c.json({
    state: hooksController.getState(),
    paused: hooksController.isPaused(),
    stats: hooksController.getStats(),
    toolHistory: hooksController.getToolHistory(),
  });
});

// ============ Hook Endpoints ============

/**
 * POST /api/hooks/stop - Claude finished responding
 * Primary completion signal from the Stop hook.
 */
app.post("/api/hooks/stop", async (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as StopEvent;
    const response = await hooksController.onStop(event);
    return c.json(response);
  } catch (error) {
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/hooks/tool - Tool completed
 * Tracks tool usage and detects errors.
 */
app.post("/api/hooks/tool", async (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as ToolEvent;
    const response = await hooksController.onTool(event);
    return c.json(response);
  } catch (error) {
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/hooks/session-start - Session begins
 */
app.post("/api/hooks/session-start", async (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as SessionStartEvent;
    const response = await hooksController.onSessionStart(event);
    return c.json(response);
  } catch (error) {
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/hooks/session-end - Session terminates
 */
app.post("/api/hooks/session-end", async (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as SessionEndEvent;
    const response = await hooksController.onSessionEnd(event);
    return c.json(response);
  } catch (error) {
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/supervisor/stop - Supervisor Claude finished responding
 * Called by the Stop hook in ./master/.claude/settings.local.json
 */
app.post("/api/supervisor/stop", async (c) => {
  try {
    const event = await c.req.json() as { session_id: string; transcript_path: string };
    console.log(`[Supervisor] Stop hook received, transcript: ${event.transcript_path}`);

    if (supervisorStopCallback) {
      supervisorStopCallback(event);
    }

    return c.json({ ok: true });
  } catch (error) {
    console.error("[Supervisor] Error handling stop hook:", error);
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * GET /api/hooks/tools - Get tool history
 */
app.get("/api/hooks/tools", (c) => {
  if (!hooksController) {
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  return c.json({
    tools: hooksController.getToolHistory(),
    count: hooksController.getToolHistory().length,
  });
});

/**
 * GET /api/transcript - Read a transcript JSONL file
 */
app.get("/api/transcript", async (c) => {
  const path = c.req.query("path");
  if (!path) {
    return c.json({ error: "Missing path parameter" }, 400);
  }

  // Only allow .jsonl files
  if (!path.endsWith(".jsonl")) {
    return c.json({ error: "Invalid file type" }, 400);
  }

  try {
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) {
      return c.json({ error: "Transcript file not found" }, 404);
    }

    const text = await file.text();
    const lines = text
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });

    return c.json({ lines });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * Format runtime in milliseconds to human-readable string.
 */
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

export { app };
