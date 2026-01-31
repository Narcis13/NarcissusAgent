# Phase 1: Core Foundation - Research

**Researched:** 2026-01-31
**Domain:** PTY Management, Session State, CLI Application with Bun
**Confidence:** HIGH

## Summary

Phase 1 requires spawning Claude Code CLI in a pseudo-terminal (PTY) with proper lifecycle management and session state tracking. The research confirms that Bun's native `Bun.Terminal` API (introduced in v1.3.5) is the correct choice for PTY management - it provides a clean, first-party solution without the native module compilation issues of `node-pty`.

The standard approach is:
1. Use `Bun.spawn()` with the `terminal` option to create a PTY-attached subprocess
2. Implement a simple discriminated union state machine for session state (no XState needed for this complexity level)
3. Use Hono for the REST API (session info endpoint)
4. Use `util.parseArgs` for CLI argument parsing

**Primary recommendation:** Use `Bun.Terminal` API for PTY management, implement session state as a discriminated union type with explicit transitions, and structure the application with clear separation between PTY manager, session manager, and CLI entry point.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.5+ | Runtime with native Terminal API | First-party PTY support, no native compilation |
| Hono | latest | HTTP server for REST API | Lightweight, TypeScript-first, built for Bun |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| strip-ansi | 7.x | Strip ANSI codes for pattern matching | Phase 2 output analysis (prepare now) |
| util.parseArgs | (built-in) | CLI argument parsing | Accept initial task argument |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bun.Terminal | node-pty | Cross-platform Windows support, but requires native compilation |
| Hono | Express | More middleware ecosystem, but heavier and not optimized for Bun |
| util.parseArgs | yargs | More features, but overkill for simple CLI |

**Installation:**
```bash
bun add hono
```

**Note:** Current system has Bun 1.3.2 installed. **Upgrade to 1.3.5+ required** for `Bun.Terminal` API:
```bash
bun upgrade
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── index.ts           # CLI entry point, argument parsing
├── pty/
│   └── manager.ts     # PTYManager class - spawn, write, cleanup
├── session/
│   ├── types.ts       # Session state types (discriminated union)
│   ├── manager.ts     # SessionManager class - state transitions
│   └── store.ts       # In-memory session storage
├── server/
│   └── routes.ts      # Hono routes for REST API
└── types.ts           # Shared types
```

### Pattern 1: PTY Manager with Terminal API
**What:** Encapsulate all PTY operations in a single manager class
**When to use:** Always - centralizes PTY lifecycle
**Example:**
```typescript
// Source: https://bun.com/docs/api/spawn (Terminal PTY support section)
import type { Subprocess, Terminal } from "bun";

interface PTYManagerOptions {
  command: string[];
  onData: (data: Uint8Array) => void;
  onExit: (exitCode: number | null, signalCode: string | null) => void;
  cols?: number;
  rows?: number;
}

class PTYManager {
  private proc: Subprocess | null = null;
  private terminal: Terminal | null = null;

  async spawn(options: PTYManagerOptions): Promise<void> {
    this.proc = Bun.spawn(options.command, {
      terminal: {
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        data: (terminal, data) => options.onData(data),
        exit: (terminal, exitCode, signal) => {
          // Note: This is PTY lifecycle exit, not process exit
          // Use proc.exited for actual process exit
        },
      },
      env: { ...process.env, TERM: "xterm-256color" },
    });

    // Handle actual process exit
    this.proc.exited.then((exitCode) => {
      options.onExit(exitCode, this.proc?.signalCode ?? null);
    });

    this.terminal = this.proc.terminal ?? null;
  }

  write(data: string): void {
    if (!this.terminal) throw new Error("PTY not initialized");
    this.terminal.write(data);
  }

  async cleanup(): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      await this.proc.exited;
    }
    if (this.terminal && !this.terminal.closed) {
      this.terminal.close();
    }
    this.proc = null;
    this.terminal = null;
  }

  get isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  get exitCode(): number | null {
    return this.proc?.exitCode ?? null;
  }
}
```

### Pattern 2: Discriminated Union State Machine
**What:** Type-safe state machine using TypeScript discriminated unions
**When to use:** Session state management with 5-6 states
**Example:**
```typescript
// Source: TypeScript handbook - discriminated unions
type SessionState =
  | { status: "idle" }
  | { status: "task_running"; taskDescription: string; startTime: Date }
  | { status: "analyzing" }
  | { status: "injecting"; command: string }
  | { status: "error"; error: string; previousStatus: string };

interface SessionMetadata {
  taskDescription: string;
  startTime: Date;
  runtime: number; // milliseconds
}

class SessionManager {
  private state: SessionState = { status: "idle" };
  private metadata: SessionMetadata | null = null;

  transition(newState: SessionState): void {
    // Validate transitions
    const validTransitions: Record<string, string[]> = {
      idle: ["task_running", "error"],
      task_running: ["analyzing", "idle", "error"],
      analyzing: ["injecting", "idle", "error"],
      injecting: ["task_running", "error"],
      error: ["idle"],
    };

    const currentStatus = this.state.status;
    if (!validTransitions[currentStatus]?.includes(newState.status)) {
      throw new Error(
        `Invalid transition: ${currentStatus} -> ${newState.status}`
      );
    }

    this.state = newState;
  }

  getState(): Readonly<SessionState> {
    return this.state;
  }
}
```

### Pattern 3: Hono REST API for Session Info
**What:** Simple REST endpoint returning session status
**When to use:** SES-03 requirement
**Example:**
```typescript
// Source: https://hono.dev/docs/getting-started/bun
import { Hono } from "hono";

const app = new Hono();

app.get("/api/session", (c) => {
  const session = sessionManager.getState();
  const metadata = sessionManager.getMetadata();

  return c.json({
    state: session.status,
    metadata: metadata ? {
      taskDescription: metadata.taskDescription,
      startTime: metadata.startTime.toISOString(),
      runtime: Date.now() - metadata.startTime.getTime(),
    } : null,
  });
});

export default app;
```

### Anti-Patterns to Avoid
- **Using `proc.stdout`/`proc.stderr` with terminal mode:** When `terminal` option is set, these return `null`. Use the `data` callback instead.
- **Forgetting to call `terminal.close()`:** Resource leak - always close terminal in cleanup.
- **Using string states without type safety:** Use discriminated unions, not string literals or enums alone.
- **Blocking on `proc.exited` in the main flow:** Use callbacks/promises properly to avoid blocking.
- **Not handling SIGTERM/SIGINT:** Register cleanup handlers for graceful shutdown.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY management | Custom forkpty bindings | Bun.Terminal API | Complex syscalls, edge cases handled |
| ANSI stripping | Regex patterns | strip-ansi | Edge cases with partial sequences, unicode |
| Argument parsing | Manual argv slicing | util.parseArgs | Flag parsing, validation, types |
| HTTP routing | Manual URL parsing | Hono | Middleware, typed responses, testing |

**Key insight:** PTY management involves complex Unix syscalls (forkpty, ioctl, signal handling). Bun's Terminal API abstracts this correctly. Never implement PTY primitives manually.

## Common Pitfalls

### Pitfall 1: Confusing PTY Exit vs Process Exit
**What goes wrong:** The `exit` callback in terminal options fires for PTY lifecycle (EOF/error), not process exit
**Why it happens:** The PTY stream and process lifecycle are separate concerns
**How to avoid:** Always use `proc.exited` promise for process exit handling
**Warning signs:** Exit code is always 0 or 1, not the actual process exit code

### Pitfall 2: Writing to Terminal After Close
**What goes wrong:** Errors or silent failures when writing to closed terminal
**Why it happens:** Process exits but terminal write is attempted
**How to avoid:** Check `terminal.closed` before writing, or catch errors
**Warning signs:** "write after end" errors, missing input injection

### Pitfall 3: Environment Variable Inheritance
**What goes wrong:** Claude Code doesn't behave like interactive terminal
**Why it happens:** Missing TERM, COLORTERM, or other terminal variables
**How to avoid:** Explicitly set `env: { ...process.env, TERM: "xterm-256color" }`
**Warning signs:** No colors, broken cursor movement, raw escape codes in output

### Pitfall 4: Bun Version Mismatch
**What goes wrong:** `Bun.Terminal` or `terminal` option doesn't exist
**Why it happens:** Using Bun < 1.3.5
**How to avoid:** Check version, upgrade with `bun upgrade`
**Warning signs:** TypeScript errors, "terminal is not a valid option"

### Pitfall 5: Not Cleaning Up on Ctrl+C
**What goes wrong:** Zombie Claude Code processes, orphaned PTY
**Why it happens:** SIGINT not handled, cleanup not called
**How to avoid:** Register process.on("SIGINT") and process.on("exit") handlers
**Warning signs:** `ps aux | grep claude` shows old processes

### Pitfall 6: State Machine Invalid Transitions
**What goes wrong:** Session gets into impossible states
**Why it happens:** Direct state assignment without validation
**How to avoid:** Use transition function with explicit valid transition map
**Warning signs:** "analyzing" state without prior "task_running"

## Code Examples

Verified patterns from official sources:

### Spawning Claude Code in PTY
```typescript
// Source: https://bun.com/docs/api/spawn
const proc = Bun.spawn(["claude"], {
  terminal: {
    cols: 120,
    rows: 40,
    data(terminal, data) {
      // data is Uint8Array, decode if needed
      const text = new TextDecoder().decode(data);
      console.log(text);
      // Also emit to subscribers for streaming
    },
  },
  env: {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  },
});

// Wait for exit
const exitCode = await proc.exited;
console.log(`Process exited with code: ${exitCode}`);
```

### Injecting Input to PTY
```typescript
// Source: https://bun.com/docs/api/spawn
// Write commands including newline to execute
proc.terminal?.write("build a hello world app\n");

// For special keys, use escape sequences
proc.terminal?.write("\x03"); // Ctrl+C
proc.terminal?.write("\x1b[A"); // Up arrow
```

### CLI Entry Point with Argument Parsing
```typescript
// Source: https://bun.com/docs/guides/process/argv
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2), // Skip bun and script path
  options: {
    port: { type: "string", default: "3000" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
  allowPositionals: true,
});

const taskDescription = positionals[0];
if (!taskDescription || values.help) {
  console.log("Usage: cco <task description> [--port 3000]");
  process.exit(values.help ? 0 : 1);
}
```

### Graceful Shutdown Handler
```typescript
// Source: Community best practice for Bun process cleanup
function createShutdownHandler(ptyManager: PTYManager) {
  const cleanup = async () => {
    console.log("\nShutting down...");
    await ptyManager.cleanup();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => {
    // Synchronous cleanup for exit event
    if (ptyManager.isRunning) {
      ptyManager.cleanup();
    }
  });
}
```

### Hono Server with Session Endpoint
```typescript
// Source: https://hono.dev/docs/getting-started/bun
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

// Enable CORS for web UI (Phase 4)
app.use("/api/*", cors());

app.get("/api/session", (c) => {
  return c.json({
    state: sessionManager.getState(),
    metadata: sessionManager.getMetadata(),
  });
});

// Export for Bun to serve
export default {
  port: parseInt(process.env.PORT ?? "3000"),
  fetch: app.fetch,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-pty (native module) | Bun.Terminal API | Bun 1.3.5 (2025) | No native compilation, simpler setup |
| Express for HTTP | Hono | 2023-2024 | Faster, smaller, better TypeScript |
| XState for simple state | Discriminated unions | TypeScript 4.0+ | Less boilerplate for simple cases |
| process.argv manual parsing | util.parseArgs | Node 18+ / Bun | Built-in, typed parsing |

**Deprecated/outdated:**
- **node-pty with Bun:** Requires native compilation, compatibility issues. Use Bun.Terminal instead.
- **winpty on Windows:** Removed from node-pty, requires Windows 1809+ with ConPTY

## Open Questions

Things that couldn't be fully resolved:

1. **Claude Code CLI exact command and arguments**
   - What we know: The command is likely `claude` or similar
   - What's unclear: Exact binary name, required arguments, working directory
   - Recommendation: Test with actual Claude Code installation, document findings

2. **Terminal resize handling**
   - What we know: `terminal.resize(cols, rows)` exists in the API
   - What's unclear: When to call it, how to detect terminal size changes
   - Recommendation: Defer to v2 (PTY-06), use fixed size for MVP

3. **Output buffering behavior**
   - What we know: `data` callback receives Uint8Array chunks
   - What's unclear: Chunk boundaries, whether full lines are guaranteed
   - Recommendation: Buffer and split on newlines for pattern matching

## Sources

### Primary (HIGH confidence)
- [Bun Spawn Documentation](https://bun.com/docs/api/spawn) - Terminal API, PTY options, exit handling
- [Bun v1.3.5 Release](https://bun.com/blog/bun-v1.3.5) - Terminal API introduction
- [Hono Documentation](https://hono.dev/docs/) - Getting started, best practices, Bun integration
- [Bun argv Documentation](https://bun.com/docs/guides/process/argv) - CLI argument parsing

### Secondary (MEDIUM confidence)
- [Hono Best Practices](https://hono.dev/docs/guides/best-practices) - Route organization patterns
- [TypeScript Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) - State machine pattern

### Tertiary (LOW confidence)
- WebSearch results on PTY pitfalls - Community patterns, may vary by version
- node-pty GitHub issues - Historical context, some may not apply to Bun.Terminal

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Bun docs confirm Terminal API
- Architecture: HIGH - Patterns are established TypeScript practices
- Pitfalls: MEDIUM - Mix of official docs and community experience

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (30 days - Bun is stable but Terminal API is new)

**Critical prerequisite:** Upgrade Bun from 1.3.2 to 1.3.5+ before implementation.
