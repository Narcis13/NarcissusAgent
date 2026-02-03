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
  console.error("[CCO] >>> STOP hook received");
  if (!hooksController) {
    console.error("[CCO] >>> Hooks controller not initialized!");
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as StopEvent;
    console.error("[CCO] >>> Stop event:", JSON.stringify(event).slice(0, 200));
    const response = await hooksController.onStop(event);
    console.error("[CCO] >>> Stop response:", response);
    return c.json(response);
  } catch (error) {
    console.error("[CCO] Error handling stop event:", error);
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/hooks/tool - Tool completed
 * Tracks tool usage and detects errors.
 */
app.post("/api/hooks/tool", async (c) => {
  console.error("[CCO] >>> TOOL hook received");
  if (!hooksController) {
    console.error("[CCO] >>> Hooks controller not initialized!");
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as ToolEvent;
    console.error("[CCO] >>> Tool event:", event.tool_name);
    const response = await hooksController.onTool(event);
    return c.json(response);
  } catch (error) {
    console.error("[CCO] Error handling tool event:", error);
    return c.json({ continue: true, error: String(error) });
  }
});

/**
 * POST /api/hooks/session-start - Session begins
 */
app.post("/api/hooks/session-start", async (c) => {
  console.error("[CCO] >>> SESSION-START hook received");
  if (!hooksController) {
    console.error("[CCO] >>> Hooks controller not initialized!");
    return c.json({ error: "Hooks controller not initialized" }, 503);
  }

  try {
    const event = (await c.req.json()) as SessionStartEvent;
    console.error("[CCO] >>> Session-start event:", event.session_id);
    const response = await hooksController.onSessionStart(event);
    return c.json(response);
  } catch (error) {
    console.error("[CCO] Error handling session-start event:", error);
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
    console.error("[CCO] Error handling session-end event:", error);
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
