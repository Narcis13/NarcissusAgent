# Stack Research: Claude Code Orchestrator

**Researched:** 2026-01-31
**Domain:** Terminal orchestration with Bun.js
**Bun Version Required:** >= 1.3.5 (for Bun.Terminal API)

## Recommended Stack

### PTY Management

#### Primary: Bun.Terminal (Built-in)
- **Package:** Built-in to Bun >= 1.3.5
- **Version:** N/A (part of Bun runtime)
- **Confidence:** HIGH

**Rationale:**
Bun v1.3.5 introduced the native `Bun.Terminal` API for spawning PTY processes. This is the recommended approach for Bun projects as it:
- Has zero dependencies
- Is maintained by the Bun team
- Provides first-class TypeScript support
- Integrates directly with `Bun.spawn()`

**API:**
```typescript
const proc = Bun.spawn(["claude"], {
  terminal: {
    cols: 80,
    rows: 24,
    data: (term, data) => {
      // Handle terminal output
      console.log(data.toString());
    },
  },
});

// Methods available:
proc.terminal.write("command\n");  // Write to terminal
proc.terminal.resize(120, 40);     // Resize terminal
proc.terminal.setRawMode(true);    // Disable line buffering
proc.terminal.close();             // Close terminal
```

**Gotchas:**
- POSIX only (Linux, macOS) - no Windows support
- Requires Bun >= 1.3.5

#### Alternative: @zenyr/bun-pty
- **Package:** `@zenyr/bun-pty`
- **Version:** 0.4.4
- **Confidence:** MEDIUM

**Rationale:**
If you need Windows support or encounter issues with Bun.Terminal, this package provides cross-platform PTY using Rust's portable-pty library via Bun FFI. It's a maintained fork with ARM64 support and smaller package size (~600KB vs ~3-4MB).

**Gotchas:**
- Uses FFI (potential security considerations)
- External dependency vs built-in
- Less mature than Bun.Terminal

---

### HTTP Server

#### Primary: Hono
- **Package:** `hono`
- **Version:** 4.11.7
- **Confidence:** HIGH

**Rationale:**
Hono is the recommended HTTP framework for Bun:
- Ultrafast and lightweight (~14KB)
- First-class Bun support with dedicated adapter
- Built-in WebSocket helper (`hono/bun`)
- Express-like API (easy migration)
- Excellent TypeScript support
- Works across multiple runtimes (Bun, Deno, Cloudflare Workers)

**Basic Setup:**
```typescript
import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';

const app = new Hono();

app.get('/ws', upgradeWebSocket((c) => ({
  onMessage(event, ws) {
    // Handle incoming messages
  },
  onClose() {
    // Handle close
  },
})));

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
};
```

**Gotchas:**
- Import WebSocket helpers from `hono/bun` not the old path
- Middleware that modifies headers may conflict with WebSocket upgrades
- For topic subscription, access `ws.raw` for native Bun ServerWebSocket

---

### WebSocket

#### Primary: Bun Built-in + Hono
- **Package:** Built-in to Bun + `hono`
- **Version:** N/A (Bun native) + 4.11.7
- **Confidence:** HIGH

**Rationale:**
Bun has native WebSocket support that's significantly faster than Node.js alternatives. Combined with Hono's `upgradeWebSocket` helper, this provides the best performance and DX.

**Features:**
- Native Bun WebSocket (extremely fast)
- Pub/sub topic subscription via `ws.raw.subscribe(topic)`
- Binary message support
- Automatic connection management

**For Topic-Based Broadcasting:**
```typescript
// Access Bun's native WebSocket for topic subscription
app.get('/ws', upgradeWebSocket((c) => ({
  onOpen(event, ws) {
    // ws.raw is Bun's ServerWebSocket
    ws.raw.subscribe('terminal-output');
  },
  onMessage(event, ws) {
    // Broadcast to topic
    ws.raw.publish('terminal-output', event.data);
  },
})));
```

**Alternative:** `@socket.io/bun-engine` if you need Socket.IO compatibility.

---

### Claude API

#### Primary: @anthropic-ai/sdk
- **Package:** `@anthropic-ai/sdk`
- **Version:** 0.72.1
- **Confidence:** HIGH

**Rationale:**
Official Anthropic SDK for TypeScript with:
- Full TypeScript definitions
- Streaming support
- Bun 1.0+ officially supported
- Messages API and legacy completions
- Tool use / function calling support

**Basic Usage:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Analyze this terminal output...' }],
});
```

**For Streaming:**
```typescript
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [...],
});

for await (const event of stream) {
  // Process streaming events
}
```

**Gotchas:**
- Requires Node.js 18+ or Bun 1.0+
- Set `ANTHROPIC_API_KEY` environment variable

#### Alternative: @anthropic-ai/claude-agent-sdk
- **Package:** `@anthropic-ai/claude-agent-sdk`
- **Version:** 0.2.12
- **Confidence:** MEDIUM

For building autonomous agents with Claude Code's capabilities. Has simplified `send()`/`receive()` patterns for multi-turn conversations.

---

### Terminal UI (Web)

#### Primary: @xterm/xterm
- **Package:** `@xterm/xterm`
- **Version:** 6.0.0
- **Confidence:** HIGH

**Rationale:**
Industry-standard terminal emulator for web:
- Used by VS Code, Hyper, and major IDEs
- Full Unicode and ANSI escape code support
- WebSocket integration via addon
- Excellent performance
- Active development

**Required Addons:**
```typescript
// Core packages
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';  // v0.12.0
import { FitAddon } from '@xterm/addon-fit';        // v0.11.0

const term = new Terminal({
  cols: 80,
  rows: 24,
  cursorBlink: true,
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');
const attachAddon = new AttachAddon(ws);
term.loadAddon(attachAddon);

term.open(document.getElementById('terminal'));
fitAddon.fit();
```

**Additional Packages:**
- `@xterm/addon-attach` (0.12.0) - WebSocket attachment
- `@xterm/addon-fit` (0.11.0) - Auto-resize to container
- `@xterm/addon-webgl` - GPU-accelerated rendering (optional)
- `@xterm/addon-search` - Search functionality (optional)

**Gotchas:**
- Package renamed from `xterm` to `@xterm/xterm` in v5+
- Requires CSS import: `@xterm/xterm/css/xterm.css`
- Modern browsers only (Chrome, Edge, Firefox, Safari)

---

### ANSI Utilities

#### Primary: strip-ansi
- **Package:** `strip-ansi`
- **Version:** 7.1.2
- **Confidence:** HIGH

**Rationale:**
De-facto standard for stripping ANSI codes:
- 250M+ weekly downloads
- TypeScript definitions included
- ES module support
- Actively maintained (updated Sept 2025)

**Usage:**
```typescript
import stripAnsi from 'strip-ansi';

const cleanText = stripAnsi('\u001B[4mUnicorn\u001B[0m');
// => 'Unicorn'
```

**Note:** Node.js has built-in `stripVTControlCharacters` but `strip-ansi` provides consistent behavior across versions.

#### For Pattern Matching: ansi-regex
- **Package:** `ansi-regex`
- **Version:** 6.1.0 (check latest)
- **Confidence:** HIGH

**Rationale:**
Provides regex for matching ANSI sequences, useful for:
- Finding ANSI codes in output
- Selective replacement
- Pattern analysis

```typescript
import ansiRegex from 'ansi-regex';

const regex = ansiRegex();
const hasAnsi = regex.test('\u001B[4m');
// => true
```

#### For ANSI Parsing: ansi-sequence-parser
- **Package:** `ansi-sequence-parser`
- **Confidence:** MEDIUM

For parsing ANSI into structured data (colors, styles) when building HTML output from terminal content.

---

## Bun-Specific Notes

### Runtime Requirements
- **Minimum Bun version:** 1.3.5 (for Bun.Terminal API)
- Current stable: Check with `bun --version`

### Native Module Compatibility
- Most npm packages work with Bun
- node-pty does NOT work with Bun (use Bun.Terminal instead)
- Native addons using N-API generally work

### Performance Advantages
- Bun's native WebSocket is 3-4x faster than ws package
- Bun.spawn is faster than Node's child_process
- Built-in bundler eliminates need for webpack/esbuild in many cases

### TypeScript
- Bun has native TypeScript support (no transpilation step needed)
- tsconfig.json still recommended for editor support
- Use `"types": ["bun-types"]` in tsconfig

### Package Manager
- Use `bun install` instead of npm/yarn
- lockfile: `bun.lockb` (binary, faster)
- Workspaces supported

---

## What NOT to Use

### node-pty
- **Reason:** Does not work with Bun runtime
- **Error:** "Cannot find module '../build/Release/pty.node'" or socket.write errors
- **Alternative:** Use `Bun.Terminal` (built-in) or `@zenyr/bun-pty`

### ws (WebSocket package)
- **Reason:** Unnecessary overhead - Bun has native WebSocket
- **Alternative:** Use Bun's built-in WebSocket with Hono

### Express.js
- **Reason:** While it works, Hono is faster and better optimized for Bun
- **Alternative:** Use Hono

### chalk (for ANSI colors)
- **Reason:** Consider `ansis` instead - smaller, faster, Bun-compatible
- **Alternative:** `ansis` or Bun's native console colors

### node-fetch
- **Reason:** Bun has native fetch API
- **Alternative:** Use built-in `fetch()`

### dotenv
- **Reason:** Bun automatically loads .env files
- **Alternative:** Just use `process.env` or `Bun.env`

---

## Complete Package.json Dependencies

```json
{
  "dependencies": {
    "hono": "^4.11.7",
    "@anthropic-ai/sdk": "^0.72.1",
    "strip-ansi": "^7.1.2",
    "ansi-regex": "^6.1.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  }
}
```

**Frontend (separate or in monorepo):**
```json
{
  "dependencies": {
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-attach": "^0.12.0",
    "@xterm/addon-fit": "^0.11.0"
  }
}
```

---

## References

- [Bun v1.3.5 Release Notes](https://bun.com/blog/bun-v1.3.5)
- [Bun.spawn Documentation](https://bun.com/docs/runtime/child-process)
- [Hono Documentation](https://hono.dev/)
- [Hono WebSocket Helper](https://hono.dev/docs/helpers/websocket)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [xterm.js](https://xtermjs.org/)
- [@zenyr/bun-pty](https://libraries.io/npm/@zenyr%2Fbun-pty)
- [strip-ansi](https://github.com/chalk/strip-ansi)
