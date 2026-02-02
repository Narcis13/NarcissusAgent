/**
 * Server Module
 *
 * Exports server setup utilities and the Hono app instance.
 */

import { app, setHooksController } from "./routes";

/**
 * Create a server configuration for Bun.serve()
 */
export function createServer(port: number = 3000) {
  return {
    port,
    fetch: app.fetch,
  };
}

export { app, setHooksController };
