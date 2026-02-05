/**
 * Interactive PTY-based Supervisor
 *
 * Spawns a persistent interactive Claude instance in a separate PTY.
 * Runs from ./master directory to isolate .claude folder from main project.
 * Uses Claude Code hooks for accurate response detection.
 */

import type { Subprocess, Terminal } from "bun";
import type { SupervisorFn } from "../hooks/controller";
import type { SupervisorDecision } from "../hooks/types";
import type { ClaudeSupervisorConfig, IterationInfo, SupervisorContext } from "./types";
import { parseResponse } from "./parse";
import { buildSupervisorPrompt, readTranscript } from "./prompt";
import { setSupervisorStopCallback } from "../server/routes";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_RESPONSE_TIMEOUT = 60000; // 60s for interactive responses
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

/** Patterns indicating Claude is waiting for input (for startup detection) */
const STARTUP_READY_INDICATORS = [
  "bypass permissions on",      // Always shown when ready
  "Claude Code",                // Banner
  "shift+tab to cycle",         // Permission prompt
];

export interface InteractiveSupervisorConfig extends ClaudeSupervisorConfig {
  /** Working directory for supervisor Claude (default: ./master) */
  cwd?: string;
  /** Response timeout in ms (default: 60000) */
  responseTimeout?: number;
  /** Callback for supervisor output (for debugging/UI) */
  onOutput?: (data: string) => void;
  /** Callback when supervisor PTY state changes */
  onStateChange?: (state: SupervisorPTYState) => void;
}

export type SupervisorPTYState =
  | "stopped"
  | "starting"
  | "ready"
  | "processing"
  | "error";

/**
 * Interactive Supervisor PTY Manager
 *
 * Manages a persistent Claude instance in a separate PTY.
 * Uses hooks for accurate response detection instead of PTY output parsing.
 * Hooks are received via the main server's /api/supervisor/stop endpoint.
 */
export class InteractiveSupervisor {
  private proc: Subprocess | null = null;
  private terminal: Terminal | null = null;
  private state: SupervisorPTYState = "stopped";
  private outputBuffer = "";
  private responseResolver: ((transcriptPath: string) => void) | null = null;
  private responseRejecter: ((error: Error) => void) | null = null;
  private responseTimeout: ReturnType<typeof setTimeout> | null = null;
  private config: Required<Omit<InteractiveSupervisorConfig, 'onIterationUpdate' | 'onOutput' | 'onStateChange'>> &
                  Pick<InteractiveSupervisorConfig, 'onIterationUpdate' | 'onOutput' | 'onStateChange'>;

  // Iteration tracking
  private iterationCount = 0;
  private consecutiveFailures = 0;

  constructor(config: InteractiveSupervisorConfig = {}) {
    this.config = {
      maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      timeout: config.timeout ?? DEFAULT_RESPONSE_TIMEOUT,
      responseTimeout: config.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
      cwd: config.cwd ?? "./master",
      onIterationUpdate: config.onIterationUpdate,
      onOutput: config.onOutput,
      onStateChange: config.onStateChange,
    };
  }

  /**
   * Start the supervisor PTY
   * Creates the working directory if needed and spawns Claude
   */
  async start(): Promise<void> {
    if (this.proc) {
      throw new Error("Supervisor already running. Call stop() first.");
    }

    this.setState("starting");

    // Ensure working directory exists
    const cwd = this.config.cwd;
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true });
      console.log(`[InteractiveSupervisor] Created working directory: ${cwd}`);
    }

    // Register callback for supervisor stop hook
    // Hook is configured in ./master/.claude/settings.local.json to POST to /api/supervisor/stop
    setSupervisorStopCallback((event) => {
      console.log(`[InteractiveSupervisor] Stop hook received, transcript: ${event.transcript_path}`);
      if (this.responseResolver) {
        this.responseResolver(event.transcript_path);
        this.responseResolver = null;
        this.responseRejecter = null;
      }
    });

    const claudeBin = `${process.env.HOME}/.claude/local/claude`;

    const decoder = new TextDecoder();

    // Spawn interactive Claude with PTY
    this.proc = Bun.spawn([claudeBin, "--dangerously-skip-permissions"], {
      cwd,
      terminal: {
        cols: 120,
        rows: 40,
        data: (_terminal, data) => {
          // Decode Uint8Array to string
          this.handleOutput(decoder.decode(data));
        },
      },
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        // Note: We do NOT disable hooks - the supervisor needs its own hooks to fire
        // The supervisor hooks POST to /api/supervisor/stop on the main server (port 13013)
      },
    });

    this.terminal = this.proc.terminal ?? null;

    // Handle process exit
    this.proc.exited.then((exitCode) => {
      console.log(`[InteractiveSupervisor] Process exited with code: ${exitCode}`);
      this.setState("stopped");
      this.proc = null;
      this.terminal = null;
    });

    // Wait for Claude to be ready
    await this.waitForReady();
    this.setState("ready");
    console.log("[InteractiveSupervisor] Claude is ready");
  }

  /**
   * Stop the supervisor PTY
   */
  async stop(): Promise<void> {
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }

    // Reject any pending response
    if (this.responseRejecter) {
      this.responseRejecter(new Error("Supervisor stopped"));
      this.responseResolver = null;
      this.responseRejecter = null;
    }

    // Unregister the callback
    setSupervisorStopCallback(null);

    if (this.proc && !this.proc.killed) {
      // Send /exit command first for graceful shutdown
      if (this.terminal && !this.terminal.closed) {
        this.terminal.write("/exit\r");
        // Give it a moment to process
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!this.proc.killed) {
        this.proc.kill("SIGTERM");
        await this.proc.exited;
      }
    }

    if (this.terminal && !this.terminal.closed) {
      this.terminal.close();
    }

    this.proc = null;
    this.terminal = null;
    this.outputBuffer = "";
    this.setState("stopped");
  }

  /**
   * Send a prompt and wait for response via hooks
   */
  async sendPrompt(prompt: string): Promise<string> {
    if (!this.terminal || this.terminal.closed) {
      throw new Error("Supervisor PTY not running");
    }

    this.setState("processing");
    this.outputBuffer = "";

    return new Promise((resolve, reject) => {
      // Set up response timeout
      this.responseTimeout = setTimeout(() => {
        this.responseResolver = null;
        this.responseRejecter = null;
        this.setState("ready");
        reject(new Error(`Response timeout after ${this.config.responseTimeout}ms`));
      }, this.config.responseTimeout);

      // Set up response resolver - receives transcript path from Stop hook
      this.responseResolver = async (transcriptPath: string) => {
        if (this.responseTimeout) {
          clearTimeout(this.responseTimeout);
          this.responseTimeout = null;
        }
        this.setState("ready");

        // Extract response from transcript
        try {
          const response = await this.extractResponseFromTranscript(transcriptPath);
          resolve(response);
        } catch (err) {
          // Fall back to output buffer if transcript reading fails
          console.warn(`[InteractiveSupervisor] Failed to read transcript, using buffer: ${err}`);
          resolve(this.cleanOutput(this.outputBuffer));
        }
      };

      this.responseRejecter = (error: Error) => {
        if (this.responseTimeout) {
          clearTimeout(this.responseTimeout);
          this.responseTimeout = null;
        }
        this.setState("ready");
        reject(error);
      };

      // Send the prompt
      this.terminal!.write(prompt + "\r");

      // For multiline prompts, Claude shows "[Pasted text...]" and may wait for confirmation
      // Send additional Enter after a short delay to confirm the pasted text
      setTimeout(() => {
        if (this.terminal && !this.terminal.closed) {
          this.terminal.write("\r");
        }
      }, 200);
    });
  }

  /**
   * Extract the last assistant response from a transcript JSONL file
   */
  private async extractResponseFromTranscript(transcriptPath: string): Promise<string> {
    console.log(`[InteractiveSupervisor] Reading transcript: ${transcriptPath}`);
    const file = Bun.file(transcriptPath);
    const text = await file.text();
    const lines = text.trim().split("\n").filter(line => line.length > 0);
    console.log(`[InteractiveSupervisor] Transcript has ${lines.length} lines`);

    // Parse JSONL and find the last assistant message
    let lastAssistantMessage = "";

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Look for assistant messages
        if (entry.type === "assistant" && entry.message?.content) {
          // Content can be array of blocks or string
          const content = entry.message.content;
          if (typeof content === "string") {
            lastAssistantMessage = content;
          } else if (Array.isArray(content)) {
            // Extract text from content blocks
            const textBlocks = content
              .filter((block: { type: string }) => block.type === "text")
              .map((block: { text: string }) => block.text);
            if (textBlocks.length > 0) {
              lastAssistantMessage = textBlocks.join("\n");
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    console.log(`[InteractiveSupervisor] Extracted assistant message (${lastAssistantMessage.length} chars): "${lastAssistantMessage.slice(0, 200)}"`);
    return lastAssistantMessage;
  }

  /**
   * Create a supervisor function compatible with HooksController
   */
  createSupervisorFn(): SupervisorFn {
    return async (context: SupervisorContext): Promise<SupervisorDecision> => {
      this.iterationCount++;

      // Notify UI of iteration progress
      this.config.onIterationUpdate?.({
        current: this.iterationCount,
        max: this.config.maxIterations,
        percentage: (this.iterationCount / this.config.maxIterations) * 100,
        consecutiveFailures: this.consecutiveFailures,
      });

      // Enforce iteration budget
      if (this.iterationCount >= this.config.maxIterations) {
        console.log(`[InteractiveSupervisor] Iteration budget exhausted (${this.iterationCount}/${this.config.maxIterations})`);
        return {
          action: 'abort',
          command: '/clear',
          reason: `Iteration budget exhausted (${this.iterationCount}/${this.config.maxIterations})`,
          confidence: 1.0,
        };
      }

      // Read the worker's transcript
      console.log(`[InteractiveSupervisor] Reading worker transcript: ${context.transcriptPath}`);
      const transcriptContent = await readTranscript(context.transcriptPath);
      console.log(`[InteractiveSupervisor] Transcript content (${transcriptContent.length} chars)`);

      // Build prompt with transcript
      const prompt = buildSupervisorPrompt(
        transcriptContent,
        context.taskDescription,
        this.iterationCount,
        this.config.maxIterations
      );

      try {
        // Ensure supervisor is running
        if (this.state === "stopped") {
          await this.start();
        }

        // Send prompt and get response
        const output = await this.sendPrompt(prompt);

        // Success - reset failure counter
        this.consecutiveFailures = 0;

        // Log raw response for debugging
        console.log(`[InteractiveSupervisor] Raw response (${output.length} chars): ${output.slice(0, 500)}`);

        // Parse response
        const parsed = parseResponse(output);
        console.log(`[InteractiveSupervisor] Parsed: action=${parsed.action}, content="${parsed.content.slice(0, 100)}"`);

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
              command: '/clear',
              reason: parsed.content || 'Aborted by supervisor',
              confidence: 0.9,
            };

          case 'continue':
            // Handle empty content - supervisor said continue but no instruction
            if (!parsed.content || parsed.content.trim() === '') {
              console.warn('[InteractiveSupervisor] Empty content for CONTINUE, using default');
              return {
                action: 'continue',
                reason: 'Supervisor response had no instruction, continuing to monitor',
                confidence: 0.5,
              };
            }
            return {
              action: 'inject',
              command: parsed.content,
              reason: 'Supervisor continues work',
              confidence: 0.8,
            };
        }
      } catch (err) {
        this.consecutiveFailures++;
        console.error(`[InteractiveSupervisor] Error (failure ${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}):`, err);

        // Abort after too many consecutive failures
        if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
          console.error(`[InteractiveSupervisor] Too many consecutive failures, aborting`);
          return {
            action: 'abort',
            command: '/clear',
            reason: `Supervisor failed ${this.consecutiveFailures} times consecutively`,
            confidence: 1.0,
          };
        }

        // Try to restart on failure
        try {
          await this.stop();
          await this.start();
        } catch (restartErr) {
          console.error("[InteractiveSupervisor] Failed to restart:", restartErr);
        }

        return {
          action: 'continue',
          reason: `Supervisor error: ${err}, resuming monitoring`,
          confidence: 0.5,
        };
      }
    };
  }

  /** Reset iteration count (call when starting new task) */
  resetIterations(): void {
    this.iterationCount = 0;
    this.consecutiveFailures = 0;
  }

  /** Current state */
  get currentState(): SupervisorPTYState {
    return this.state;
  }

  /** Whether supervisor is running and ready */
  get isReady(): boolean {
    return this.state === "ready";
  }

  // Private methods

  private setState(state: SupervisorPTYState): void {
    this.state = state;
    this.config.onStateChange?.(state);
  }

  private handleOutput(data: string): void {
    this.outputBuffer += data;
    this.config.onOutput?.(data);
    // Note: Response detection now handled by hooks, not output parsing
  }

  private cleanOutput(output: string): string {
    // Remove ANSI escape codes
    let cleaned = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

    // Remove the input prompt we sent
    const lines = cleaned.split("\n");

    // Find the actual response (skip echoed input and prompts)
    const responseLines: string[] = [];
    let foundContent = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines at the start
      if (!foundContent && !trimmed) continue;

      // Skip prompt-like lines
      if (trimmed.match(/^[❯>]\s*$/) || trimmed === ">") continue;

      // Found content
      if (trimmed) {
        foundContent = true;
      }

      if (foundContent) {
        responseLines.push(line);
      }
    }

    // Remove trailing prompt
    while (responseLines.length > 0) {
      const lastLine = responseLines[responseLines.length - 1];
      if (!lastLine) break;
      const last = lastLine.trim();
      if (!last || last.match(/^[❯>]\s*$/) || last === ">") {
        responseLines.pop();
      } else {
        break;
      }
    }

    return responseLines.join("\n").trim();
  }

  private async waitForReady(timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Supervisor startup timeout after ${timeout}ms`));
      }, timeout);

      const originalBuffer = this.outputBuffer;

      const checkReady = () => {
        // Check if we have enough output and see ready indicators
        if (this.outputBuffer.length > originalBuffer.length + 100) {
          for (const indicator of STARTUP_READY_INDICATORS) {
            if (this.outputBuffer.includes(indicator)) {
              clearTimeout(timeoutId);
              resolve();
              return;
            }
          }
        }

        // Keep checking
        if (this.state !== "stopped") {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }
}

/**
 * Create an interactive supervisor factory function
 *
 * Manages the lifecycle of the InteractiveSupervisor instance.
 * The supervisor PTY is started lazily on first use.
 */
export function createInteractiveSupervisor(
  config: InteractiveSupervisorConfig = {}
): { supervisor: SupervisorFn; instance: InteractiveSupervisor } {
  const instance = new InteractiveSupervisor(config);
  const supervisor = instance.createSupervisorFn();

  return { supervisor, instance };
}
