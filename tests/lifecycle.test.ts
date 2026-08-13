import { describe, expect, it } from "vitest";
import {
  BoundedLifecycle,
  InvocationExecutionError,
} from "../src/lifecycle.js";
import { FakeRuntimeAdapter } from "./support/fake-runtime.js";

const matchingIdentity = (agentId: string) => ({
  labels: { "agent-id": agentId },
});

describe("BoundedLifecycle", () => {
  it("coalesces duplicate initialization into one usable environment", async () => {
    const runtime = new FakeRuntimeAdapter();
    const lifecycle = new BoundedLifecycle(runtime);
    const input = {
      agentId: "agent-1",
      invocationId: "message-1",
      identity: matchingIdentity("agent-1"),
    };

    const [first, second] = await Promise.all([
      lifecycle.initialize(input),
      lifecycle.initialize(input),
    ]);

    expect(first).toBe(second);
    expect(runtime.driveCreates).toBe(1);
    expect(runtime.sandboxCreates).toBe(1);
    expect(runtime.mounts).toBe(1);

    await lifecycle.teardown(first);
  });

  it("does not execute when the Drive mount fails", async () => {
    const runtime = new FakeRuntimeAdapter();
    runtime.failMount = true;
    const lifecycle = new BoundedLifecycle(runtime);

    await expect(
      lifecycle.invoke({
        agentId: "agent-1",
        invocationId: "message-2",
        identity: matchingIdentity("agent-1"),
        command: "write:/result.txt:never-written",
      }),
    ).rejects.toThrow("Mount failed");

    expect(runtime.executions).toBe(0);
    expect(runtime.sandboxDeletes).toBe(1);
  });

  it("cleans up the Sandbox after a command timeout", async () => {
    const runtime = new FakeRuntimeAdapter();
    const lifecycle = new BoundedLifecycle(runtime);

    await expect(
      lifecycle.invoke({
        agentId: "agent-1",
        invocationId: "message-3",
        identity: matchingIdentity("agent-1"),
        command: "timeout",
        timeoutSeconds: 5,
      }),
    ).rejects.toThrow("timed out after 5s");

    expect(runtime.sandboxDeletes).toBe(1);
    expect(runtime.sandboxes.size).toBe(0);
  });

  it("rejects waits above the documented 60-second ceiling before provisioning", async () => {
    const runtime = new FakeRuntimeAdapter();
    const lifecycle = new BoundedLifecycle(runtime);

    await expect(
      lifecycle.invoke({
        agentId: "agent-1",
        invocationId: "message-too-long",
        identity: matchingIdentity("agent-1"),
        command: "read:/result.txt",
        timeoutSeconds: 61,
      }),
    ).rejects.toThrow("1 to 60 seconds");

    expect(runtime.driveCreates).toBe(0);
    expect(runtime.sandboxCreates).toBe(0);
  });

  it("keeps Drive data available to a second Sandbox", async () => {
    const runtime = new FakeRuntimeAdapter();
    const lifecycle = new BoundedLifecycle(runtime);

    await lifecycle.invoke({
      agentId: "agent-1",
      invocationId: "message-4",
      identity: matchingIdentity("agent-1"),
      command: "write:/result.txt:durable-result",
    });

    const recovered = await lifecycle.invoke({
      agentId: "agent-1",
      invocationId: "message-5",
      identity: matchingIdentity("agent-1"),
      command: "read:/result.txt",
    });

    expect(recovered.logs).toBe("durable-result");
    expect(runtime.driveCreates).toBe(1);
    expect(runtime.sandboxCreates).toBe(2);
    expect(runtime.sandboxDeletes).toBe(2);
  });

  it("rejects an unmatched workload identity before command execution", async () => {
    const runtime = new FakeRuntimeAdapter();
    const lifecycle = new BoundedLifecycle(runtime);

    await expect(
      lifecycle.invoke({
        agentId: "agent-1",
        invocationId: "message-6",
        identity: matchingIdentity("another-agent"),
        command: "read:/result.txt",
      }),
    ).rejects.toThrow("workload identity did not match");

    expect(runtime.executions).toBe(0);
    expect(runtime.sandboxDeletes).toBe(1);
  });

  it("preserves both command and cleanup failures", async () => {
    const runtime = new FakeRuntimeAdapter();
    runtime.failCleanup = true;
    const lifecycle = new BoundedLifecycle(runtime);

    await expect(
      lifecycle.invoke({
        agentId: "agent-1",
        invocationId: "message-7",
        identity: matchingIdentity("agent-1"),
        command: "fail",
      }),
    ).rejects.toBeInstanceOf(InvocationExecutionError);
  });
});
