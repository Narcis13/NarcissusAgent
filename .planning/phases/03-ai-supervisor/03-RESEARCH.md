# Phase 3: AI Supervisor - Research

**Researched:** 2026-02-04
**Domain:** Claude Code CLI supervisor via `claude -p`, process spawning, decision prompt engineering
**Confidence:** HIGH

## Summary

Phase 3 implements an AI supervisor where Bun spawns another Claude Code instance using `claude -p "..."` to make decisions about the inner Claude Code's work. This is a "Claude supervising Claude" architecture where the supervisor is NOT a direct Claude API call, but a fresh spawn of the Claude Code CLI per decision.

The key technical domains are:
1. **Process spawning** - Using Bun's `$` shell to run `claude -p "..."` and capture output
2. **Response parsing** - Extracting action markers (`[COMPLETE]`, `[ABORT]`, `[CONTINUE]`) from text output
3. **Prompt engineering** - Crafting effective supervisor prompts with iteration context
4. **Iteration budget** - Enforcing max steps (50 default) before forced stop

The standard approach is to use `Bun.$` with `.text()` and `.nothrow()` for robust process execution, parse plain text responses for bracketed markers, and build prompts that include recent tool history plus iteration metadata.

**Primary recommendation:** Use `Bun.$\`claude -p "${prompt}"\`.nothrow().quiet().text()` pattern with timeout, parse response for `[COMPLETE]`, `[ABORT]`, `[CONTINUE]` markers, inject `/clear` on abort, and track iteration count in the supervisor prompt.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun shell (`$`) | Built-in | Spawn `claude -p` process | Native to Bun, simple text capture |
| Claude Code CLI | Latest | Supervisor AI via `-p` flag | Architecture decision - Claude supervising Claude |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | Pure Bun shell + string parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Bun.$` | `Bun.spawn()` | More verbose, $` is simpler for CLI execution |
| Plain text markers | JSON output | User decided plain text - simpler parsing, easier debugging |
| Fresh spawn per decision | Long-running supervisor | User decided fresh spawn - clean context, no state drift |

**Installation:**
```bash
# No additional dependencies - Bun shell is built-in
# Claude Code CLI must be installed at ~/.claude/local/claude
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── supervisor/
│   ├── index.ts           # Exports createSupervisor
│   ├── types.ts           # SupervisorContext, SupervisorResponse
│   ├── spawn.ts           # Bun.$ invocation wrapper
│   ├── parse.ts           # Response marker parsing
│   └── prompt.ts          # Prompt template building
├── hooks/
│   ├── controller.ts      # (existing) - calls supervisor
│   └── types.ts           # (existing) - SupervisorDecision
└── (existing modules)
```

### Pattern 1: Bun Shell Process Execution
**What:** Use `Bun.$` template tag to spawn Claude CLI and capture output
**When to use:** Every supervisor decision call
**Example:**
```typescript
// Source: https://bun.com/docs/runtime/shell
import { $ } from "bun";

interface SpawnResult {
  output: string;
  exitCode: number;
  error?: string;
}

async function spawnSupervisor(prompt: string, timeout: number = 30000): Promise<SpawnResult> {
  const claudeBin = `${process.env.HOME}/.claude/local/claude`;

  try {
    // Use .nothrow() to prevent exceptions on non-zero exit
    // Use .quiet() to not print to stdout (we capture it)
    const result = await $`${claudeBin} -p ${prompt} --dangerously-skip-permissions`
      .nothrow()
      .quiet()
      .timeout(timeout);

    return {
      output: result.stdout.toString(),
      exitCode: result.exitCode,
      error: result.exitCode !== 0 ? result.stderr.toString() : undefined,
    };
  } catch (err) {
    // Timeout or other error
    return {
      output: "",
      exitCode: -1,
      error: String(err),
    };
  }
}
```

### Pattern 2: Response Marker Parsing
**What:** Parse plain text response for action markers at the start
**When to use:** After receiving supervisor output
**Example:**
```typescript
// Source: User decision in CONTEXT.md
type SupervisorAction = 'complete' | 'abort' | 'continue';

interface ParsedResponse {
  action: SupervisorAction;
  content: string;  // Text after the marker
  raw: string;      // Full response
}

function parseResponse(output: string): ParsedResponse {
  const trimmed = output.trim();

  // Check for markers at the start of response
  if (trimmed.startsWith('[COMPLETE]')) {
    return {
      action: 'complete',
      content: trimmed.slice('[COMPLETE]'.length).trim(),
      raw: output,
    };
  }

  if (trimmed.startsWith('[ABORT]')) {
    return {
      action: 'abort',
      content: trimmed.slice('[ABORT]'.length).trim(),
      raw: output,
    };
  }

  if (trimmed.startsWith('[CONTINUE]')) {
    return {
      action: 'continue',
      content: trimmed.slice('[CONTINUE]'.length).trim(),
      raw: output,
    };
  }

  // Default: treat as continue if no marker (defensive)
  console.warn('No marker found in supervisor response, defaulting to continue');
  return {
    action: 'continue',
    content: trimmed,
    raw: output,
  };
}
```

### Pattern 3: Supervisor Prompt Template
**What:** Build context-rich prompt for supervisor decision
**When to use:** Before spawning supervisor process
**Example:**
```typescript
// Source: Claude prompt engineering best practices
interface SupervisorContext {
  taskDescription: string;
  toolHistory: ToolHistoryEntry[];
  iterationCount: number;
  maxIterations: number;
  sessionId: string;
}

function buildSupervisorPrompt(context: SupervisorContext): string {
  // Format tool history as readable summary
  const toolSummary = context.toolHistory
    .map((t, i) => {
      const status = t.error ? 'ERROR' : 'OK';
      const output = t.output.slice(0, 200) + (t.output.length > 200 ? '...' : '');
      return `${i + 1}. ${t.toolName} [${status}]: ${output}`;
    })
    .join('\n');

  return `You are a supervisor monitoring a Claude Code instance working on a task.

TASK: ${context.taskDescription}

ITERATION: ${context.iterationCount}/${context.maxIterations}

RECENT TOOL ACTIVITY:
${toolSummary || '(no tools executed yet)'}

Based on this information, decide the next action:

- If the work is COMPLETE (task accomplished, no more work needed):
  Respond with [COMPLETE] followed by a brief summary of what was accomplished.

- If something is WRONG and we should STOP (errors, wrong direction, stuck):
  Respond with [ABORT] followed by the reason for stopping.

- If work should CONTINUE (more steps needed, inject a command):
  Respond with [CONTINUE] followed by the exact text to send to the inner Claude.
  This could be a follow-up instruction, clarification, or the next step.

Respond with ONLY the marker and content. No additional explanation.`;
}
```

### Pattern 4: Integration with HooksController
**What:** Wire supervisor function into existing controller
**When to use:** Main entry point setup
**Example:**
```typescript
// Source: Existing codebase pattern from src/hooks/controller.ts
import { HooksController } from './hooks/controller';
import type { SupervisorFn } from './hooks/controller';
import type { SupervisorDecision } from './hooks/types';

function createClaudeSupervisor(maxIterations: number = 50): SupervisorFn {
  let iterationCount = 0;

  return async (context): Promise<SupervisorDecision> => {
    iterationCount++;

    // Check iteration budget
    if (iterationCount >= maxIterations) {
      return {
        action: 'abort',
        reason: `Iteration budget exhausted (${maxIterations} iterations)`,
        confidence: 1.0,
      };
    }

    // Build prompt and spawn supervisor
    const prompt = buildSupervisorPrompt({
      ...context,
      iterationCount,
      maxIterations,
    });

    const result = await spawnSupervisor(prompt);

    if (result.exitCode !== 0) {
      // Supervisor process failed - continue monitoring
      console.error('Supervisor spawn failed:', result.error);
      return {
        action: 'continue',
        reason: 'Supervisor error, continuing to monitor',
        confidence: 0.5,
      };
    }

    // Parse response
    const parsed = parseResponse(result.output);

    switch (parsed.action) {
      case 'complete':
        return {
          action: 'stop',
          reason: parsed.content || 'Work complete',
          confidence: 0.9,
        };

      case 'abort':
        return {
          action: 'abort',
          command: '/clear',  // Inject /clear before stopping
          reason: parsed.content || 'Aborted by supervisor',
          confidence: 0.9,
        };

      case 'continue':
        return {
          action: 'inject',
          command: parsed.content,
          reason: 'Supervisor continues work',
          confidence: 0.8,
        };
    }
  };
}

// Usage in main entry point
const hooksController = new HooksController({ /* event handlers */ });
hooksController.setSupervisor(createClaudeSupervisor(50));
```

### Anti-Patterns to Avoid
- **Long-running supervisor process:** User decision is fresh spawn per decision - cleaner context
- **JSON parsing for response:** User decided plain text markers - simpler, more robust
- **Direct Claude API calls:** Architecture is Claude Code supervising Claude Code
- **No timeout on spawn:** Always set timeout to prevent hanging
- **Blocking main event loop:** Use async/await properly, don't block PTY data handling

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process spawning | `child_process.exec` | `Bun.$` template tag | Cleaner syntax, native Bun |
| Text capture | Manual pipe handling | `.text()` method | Built into Bun shell |
| Timeout handling | setTimeout + kill | `.timeout()` method | Built into Bun shell |
| Error handling | Manual exit code check | `.nothrow()` pattern | Bun shell idiom |

**Key insight:** Bun's `$` shell provides everything needed for spawning `claude -p`. No need for external libraries or complex subprocess management.

## Common Pitfalls

### Pitfall 1: Forgetting `.nothrow()`
**What goes wrong:** Non-zero exit code throws exception, crashes supervisor
**Why it happens:** Claude CLI may exit non-zero for various reasons
**How to avoid:** Always use `.nothrow()` and check `exitCode` manually
**Warning signs:** Unhandled exceptions, supervisor failures

### Pitfall 2: No Timeout on Supervisor Spawn
**What goes wrong:** Supervisor hangs indefinitely if Claude takes too long
**Why it happens:** Large context or complex prompts can be slow
**How to avoid:** Use `.timeout(30000)` or similar reasonable timeout
**Warning signs:** Process hangs, no response

### Pitfall 3: Not Escaping Prompt in Shell
**What goes wrong:** Shell injection or malformed command
**Why it happens:** Prompt contains quotes, newlines, special chars
**How to avoid:** Let Bun shell handle interpolation with template literals
**Warning signs:** Command fails, weird output

### Pitfall 4: Iteration Budget Not Tracked
**What goes wrong:** Infinite loop, runaway costs
**Why it happens:** No counter, no forced stop
**How to avoid:** Track iterations in supervisor function closure, hard stop at limit
**Warning signs:** Session runs forever, high costs

### Pitfall 5: Missing `/clear` on Abort
**What goes wrong:** Inner Claude left in inconsistent state after abort
**Why it happens:** Abort decision doesn't inject cleanup command
**How to avoid:** On `[ABORT]`, inject `/clear` into PTY before stopping
**Warning signs:** Next session starts with stale context

### Pitfall 6: No Marker Handling Default
**What goes wrong:** Supervisor returns unexpected format, crashes parser
**Why it happens:** Claude might not follow format exactly
**How to avoid:** Default to `continue` action if no marker found, log warning
**Warning signs:** Parse failures, undefined behavior

## Code Examples

Verified patterns from official sources:

### Bun Shell Basic Execution
```typescript
// Source: https://bun.com/docs/runtime/shell
import { $ } from "bun";

// Get text output (automatically quiet)
const output = await $`echo "hello"`.text();
// => "hello\n"

// With nothrow for error handling
const result = await $`exit 1`.nothrow();
console.log(result.exitCode); // 1

// With timeout
const timedResult = await $`sleep 60`.timeout(5000).nothrow();
// Will fail after 5 seconds
```

### Claude CLI Print Mode
```typescript
// Source: https://code.claude.com/docs/en/cli-reference
// The -p flag runs non-interactive mode and exits after response

const claudeBin = `${process.env.HOME}/.claude/local/claude`;

// Basic query
const response = await $`${claudeBin} -p "What is 2+2?"`.text();

// With permissions skip (for automation)
const automated = await $`${claudeBin} -p "analyze this" --dangerously-skip-permissions`.text();

// With max turns limit (optional safeguard)
const limited = await $`${claudeBin} -p "do task" --max-turns 5 --dangerously-skip-permissions`.text();
```

### Complete Supervisor Implementation
```typescript
// Source: Project-specific based on CONTEXT.md decisions
import { $ } from "bun";
import type { SupervisorFn } from "../hooks/controller";
import type { SupervisorDecision, ToolHistoryEntry } from "../hooks/types";

interface ClaudeSupervisorConfig {
  maxIterations?: number;
  timeout?: number;
}

export function createClaudeSupervisor(config: ClaudeSupervisorConfig = {}): SupervisorFn {
  const { maxIterations = 50, timeout = 30000 } = config;
  let iterationCount = 0;
  const claudeBin = `${process.env.HOME}/.claude/local/claude`;

  return async (context): Promise<SupervisorDecision> => {
    iterationCount++;

    // Enforce iteration budget
    if (iterationCount >= maxIterations) {
      return {
        action: 'abort',
        command: '/clear',
        reason: `Iteration budget exhausted (${iterationCount}/${maxIterations})`,
        confidence: 1.0,
      };
    }

    // Build supervisor prompt
    const prompt = buildPrompt(context, iterationCount, maxIterations);

    // Spawn supervisor
    try {
      const result = await $`${claudeBin} -p ${prompt} --dangerously-skip-permissions`
        .nothrow()
        .quiet()
        .timeout(timeout);

      if (result.exitCode !== 0) {
        console.error('Supervisor exited with code:', result.exitCode);
        return {
          action: 'continue',
          reason: 'Supervisor error, resuming monitoring',
          confidence: 0.5,
        };
      }

      const output = result.stdout.toString().trim();
      return parseToDecision(output);
    } catch (err) {
      console.error('Supervisor spawn error:', err);
      return {
        action: 'continue',
        reason: `Spawn error: ${err}`,
        confidence: 0.3,
      };
    }
  };
}

function buildPrompt(
  context: { taskDescription: string; toolHistory: ToolHistoryEntry[]; sessionId: string },
  iteration: number,
  maxIterations: number
): string {
  const tools = context.toolHistory.slice(-10).map((t, i) => {
    const status = t.error ? `ERROR: ${t.error}` : 'OK';
    const snippet = t.output.slice(0, 150).replace(/\n/g, ' ');
    return `[${i + 1}] ${t.toolName} (${status}): ${snippet}`;
  }).join('\n');

  return `You supervise a Claude Code instance.

TASK: ${context.taskDescription}
ITERATION: ${iteration}/${maxIterations}

RECENT TOOLS:
${tools || '(none)'}

Respond with ONE marker at the start:
[COMPLETE] if task is done
[ABORT] if something is wrong
[CONTINUE] followed by the next instruction

Marker only, then content. Example:
[CONTINUE] Now implement the test cases`;
}

function parseToDecision(output: string): SupervisorDecision {
  if (output.startsWith('[COMPLETE]')) {
    return {
      action: 'stop',
      reason: output.slice('[COMPLETE]'.length).trim() || 'Task complete',
      confidence: 0.9,
    };
  }

  if (output.startsWith('[ABORT]')) {
    return {
      action: 'abort',
      command: '/clear',
      reason: output.slice('[ABORT]'.length).trim() || 'Aborted',
      confidence: 0.9,
    };
  }

  if (output.startsWith('[CONTINUE]')) {
    return {
      action: 'inject',
      command: output.slice('[CONTINUE]'.length).trim(),
      reason: 'Continuing work',
      confidence: 0.8,
    };
  }

  // Fallback: treat as continue with the full output as command
  return {
    action: 'inject',
    command: output || '/clear',
    reason: 'No marker found, treating as continue',
    confidence: 0.5,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Claude API | Claude Code CLI (`-p`) | User decision | Simpler, Claude-supervising-Claude |
| JSON structured output | Plain text markers | User decision | Easier debugging, robust parsing |
| Long-running supervisor | Fresh spawn per decision | User decision | Clean context, no state drift |
| `Bun.spawn()` | `Bun.$` shell | Bun 1.0+ | Cleaner syntax |

**Deprecated/outdated:**
- **@anthropic-ai/sdk for supervisor:** User decided to use Claude Code CLI instead
- **Complex JSON response parsing:** Plain text markers are simpler and sufficient

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal timeout duration**
   - What we know: 30 seconds is reasonable default
   - What's unclear: How long complex supervisor prompts take in practice
   - Recommendation: Start with 30s, make configurable, add logging

2. **Prompt length limits**
   - What we know: `-p` accepts prompts up to shell argument limits
   - What's unclear: Practical limit before truncation issues
   - Recommendation: Keep prompts under 10KB, truncate tool history if needed

3. **Supervisor prompt tuning**
   - What we know: Clear instructions with markers work well
   - What's unclear: Optimal prompt for different task types
   - Recommendation: Start with basic template, iterate based on real usage

4. **Concurrent supervisor calls**
   - What we know: Current design is serial (one at a time)
   - What's unclear: Whether concurrent calls would be beneficial
   - Recommendation: Keep serial for simplicity, review if bottleneck

## Sources

### Primary (HIGH confidence)
- [Bun Shell Documentation](https://bun.com/docs/runtime/shell) - `$` template tag, `.text()`, `.nothrow()`, `.timeout()`
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) - `-p` flag, `--output-format`, `--max-turns`
- [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices) - Explicit instructions, structured output

### Secondary (MEDIUM confidence)
- [Bun Shell Blog Post](https://bun.sh/blog/the-bun-shell) - Template tag design patterns
- [Bun.$ API Reference](https://bun.com/reference/bun/$) - ShellError class, return types

### Tertiary (LOW confidence)
- WebSearch results for supervisor prompt engineering patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using Bun built-ins, Claude CLI documented
- Architecture: HIGH - User decisions in CONTEXT.md are explicit
- Pitfalls: MEDIUM - Based on general subprocess/CLI patterns, not Phase 3 specific
- Prompt engineering: MEDIUM - Best practices documented, tuning needed

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (30 days - Bun shell stable, Claude CLI stable)

**Dependencies from Phase 2:**
- HooksController.setSupervisor() exists for injecting supervisor function
- SupervisorDecision type already defined with action, command, reason, confidence
- onInject callback for writing commands to PTY
- Tool history tracking in controller
