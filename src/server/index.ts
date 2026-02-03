/**
 * Server Module
 *
 * Exports server setup utilities with WebSocket support and HTML routes.
 */

import type { Server, ServerWebSocket } from "bun";
import { app, setHooksController } from "./routes";
import { eventBroadcaster } from "../websocket";
import monitorUI from "../ui/index.html";

// WebSocket data type
interface WSData {
  connectedAt: Date;
}

/**
 * Create a server configuration for Bun.serve()
 * Includes HTTP routes, WebSocket handlers, and HTML imports
 */
export function createServer(port: number = 3000) {
  return {
    port,
    // Use Bun's routes for HTML imports
    routes: {
      "/monitor": monitorUI,
    },
    fetch: (req: Request, server: Server<WSData>) => {
      const url = new URL(req.url);

      // WebSocket upgrade for /ws
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: { connectedAt: new Date() },
        });
        if (upgraded) {
          return undefined;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Handle Hono routes (API endpoints)
      return app.fetch(req, { server });
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        eventBroadcaster.onOpen(ws);
      },
      message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
        eventBroadcaster.onMessage(ws, message);
      },
      close(ws: ServerWebSocket<WSData>) {
        eventBroadcaster.onClose(ws);
      },
    },
  };
}

/**
 * Initialize the broadcaster with the server reference
 */
export function initializeBroadcaster(server: Server<WSData>): void {
  eventBroadcaster.setServer(server);
}

export { app, setHooksController };
