/**
 * Output Buffer
 *
 * Fixed-size ring buffer that stores recent terminal output lines.
 * Prevents unbounded memory growth during long-running sessions.
 */

export class OutputBuffer {
  private lines: string[] = [];
  private readonly maxLines: number;

  /**
   * Create a new output buffer
   * @param maxLines Maximum lines to retain (default: 100)
   */
  constructor(maxLines: number = 100) {
    if (maxLines < 1) {
      throw new Error('maxLines must be at least 1');
    }
    this.maxLines = maxLines;
  }

  /**
   * Append text to the buffer, splitting by newlines
   * @param text Raw text to append (may contain multiple lines)
   */
  append(text: string): void {
    // Split on newlines, preserving empty lines
    const newLines = text.split('\n');

    // Handle case where last line didn't end with newline
    // by joining with existing partial line
    if (this.lines.length > 0 && !this.lines[this.lines.length - 1].endsWith('\n')) {
      const partial = this.lines.pop() || '';
      newLines[0] = partial + newLines[0];
    }

    this.lines.push(...newLines);

    // Trim to max size, keeping most recent
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines);
    }
  }

  /**
   * Get recent lines from the buffer
   * @param count Number of lines to retrieve (default: 50)
   * @returns Joined string of recent lines
   */
  getRecent(count: number = 50): string {
    const sliceCount = Math.min(count, this.lines.length);
    return this.lines.slice(-sliceCount).join('\n');
  }

  /**
   * Get all buffered lines
   * @returns Joined string of all lines
   */
  getAll(): string {
    return this.lines.join('\n');
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.lines = [];
  }

  /**
   * Get current line count
   */
  get length(): number {
    return this.lines.length;
  }

  /**
   * Check if buffer is at capacity
   */
  get isFull(): boolean {
    return this.lines.length >= this.maxLines;
  }
}
