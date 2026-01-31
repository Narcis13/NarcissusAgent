/**
 * Hono REST API Routes
 *
 * Provides HTTP endpoints for session status and health checks.
 * CORS enabled for Phase 4 web UI integration.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionManager } from "../session";

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
