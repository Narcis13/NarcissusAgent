/**
 * PTY Manager Implementation
 *
 * Spawns and controls Claude Code in a pseudo-terminal using Bun's native
 * Terminal API (v1.3.5+). All output capture, input injection, and lifecycle
 * management flows through this class.
 */

import type { Subprocess, Terminal } from "bun";
import type { PTYManagerOptions, PTYManager as IPTYManager } from "./types";

export class PTYManager implements IPTYManager {
  private proc: Subprocess | null = null;
  private terminal: Terminal | null = null;
  private _exitCode: number | null = null;

  /**
   * Spawn a new subprocess attached to a PTY
   * @param options - Configuration for the PTY and subprocess
   * @throws Error if PTY is already running
   */
  async spawn(options: PTYManagerOptions): Promise<void> {
    if (this.proc) {
      throw new Error("PTY already running. Call cleanup() first.");
    }

    this.proc = Bun.spawn(options.command, {
      terminal: {
        cols: options.cols ?? 120,
        rows: options.rows ?? 40,
        data: (_terminal, data) => {
          options.onData(data);
        },
      },
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    this.terminal = this.proc.terminal ?? null;

    // Handle actual process exit via proc.exited promise
    // (NOT the terminal.exit callback which is for PTY lifecycle)
    this.proc.exited.then((exitCode) => {
      this._exitCode = exitCode;
      options.onExit(exitCode, this.proc?.signalCode ?? null);
    });
  }

  /**
   * Write data to the PTY input
   * @param data - String data to write (can include escape sequences)
   * @throws Error if PTY is not initialized or terminal is closed
   */
  write(data: string): void {
    if (!this.terminal) {
      throw new Error("PTY not initialized");
    }
    if (this.terminal.closed) {
      throw new Error("Cannot write to closed terminal");
    }
    this.terminal.write(data);
  }

  /**
   * Clean up PTY resources and terminate the subprocess
   * Sends SIGTERM and waits for graceful exit
   */
  async cleanup(): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      // Wait for process to actually exit
      await this.proc.exited;
    }
    if (this.terminal && !this.terminal.closed) {
      this.terminal.close();
    }
    this.proc = null;
    this.terminal = null;
  }

  /** Whether the subprocess is currently running */
  get isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  /** Exit code of the subprocess (null if still running or killed by signal) */
  get exitCode(): number | null {
    return this._exitCode;
  }
}
