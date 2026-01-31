/**
 * PTY Manager Types
 *
 * Defines interfaces for managing pseudo-terminal (PTY) operations
 * using Bun's native Terminal API (v1.3.5+).
 */

/**
 * Options for spawning a PTY-attached subprocess
 */
export interface PTYManagerOptions {
  /** Command and arguments to spawn (e.g., ["claude"]) */
  command: string[];
  /** Callback invoked when data is received from the PTY */
  onData: (data: Uint8Array) => void;
  /** Callback invoked when the process exits */
  onExit: (exitCode: number | null, signalCode: string | null) => void;
  /** Terminal width in columns (default: 80) */
  cols?: number;
  /** Terminal height in rows (default: 24) */
  rows?: number;
}

/**
 * Interface for PTY manager operations
 *
 * Encapsulates all PTY lifecycle operations:
 * - Spawning a subprocess attached to a PTY
 * - Writing input to the PTY
 * - Cleaning up resources
 */
export interface PTYManager {
  /**
   * Spawn a new subprocess attached to a PTY
   * @param options - Configuration for the PTY and subprocess
   */
  spawn(options: PTYManagerOptions): Promise<void>;

  /**
   * Write data to the PTY input
   * @param data - String data to write (can include escape sequences)
   */
  write(data: string): void;

  /**
   * Clean up PTY resources and terminate the subprocess
   * Sends SIGTERM and waits for graceful exit
   */
  cleanup(): Promise<void>;

  /** Whether the subprocess is currently running */
  readonly isRunning: boolean;

  /** Exit code of the subprocess (null if still running or killed by signal) */
  readonly exitCode: number | null;
}
