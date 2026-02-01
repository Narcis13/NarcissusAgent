import { test, expect, beforeEach } from "bun:test";
import { SessionManager } from "./manager";
import { sessionStore } from "./store";

// Reset store before each test
beforeEach(() => {
  sessionStore.setState({ status: "idle" });
});

test("Session state transitions correctly: idle -> task_running", () => {
  const manager = new SessionManager();

  // Initial state should be idle
  expect(manager.getState().status).toBe("idle");

  // Start a task
  manager.startTask("test task");

  // State should change to task_running
  expect(manager.getState().status).toBe("task_running");

  const state = manager.getState();
  if (state.status === "task_running") {
    expect(state.taskDescription).toBe("test task");
    expect(state.startTime).toBeInstanceOf(Date);
  }
});

test("Session state transitions correctly: task_running -> idle", () => {
  const manager = new SessionManager();

  manager.startTask("test task");
  expect(manager.getState().status).toBe("task_running");

  manager.setIdle();
  expect(manager.getState().status).toBe("idle");
});

test("Invalid transition throws error", () => {
  const manager = new SessionManager();

  // Can't go from idle directly to analyzing
  expect(() => manager.setAnalyzing()).toThrow(/Invalid state transition/);
});

test("Metadata is set when task starts", () => {
  const manager = new SessionManager();

  manager.startTask("build a feature");

  const metadata = manager.getMetadata();
  expect(metadata).not.toBeNull();
  expect(metadata?.taskDescription).toBe("build a feature");
  expect(metadata?.startTime).toBeInstanceOf(Date);
  expect(typeof metadata?.runtime).toBe("number");
});
