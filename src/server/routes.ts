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

/**
 * Set the hooks controller for API endpoints
 */
export function setHooksController(controller: HooksController): void {
  hooksController = controller;
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
