import "dotenv/config";
import { DriveInstance, SandboxInstance } from "@blaxel/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlaxelRuntimeAdapter,
  BoundedLifecycle,
  driveNameForAgent,
  isBlaxelWorkloadNotFound,
  sandboxNameForInvocation,
} from "../src/index.js";

const describeLive =
  process.env.RUN_BLAXEL_LIVE_TESTS === "1" ? describe : describe.skip;
const agentId = `cookbook-live-${Date.now()}`;

describeLive("Blaxel live lifecycle", () => {
  const region = process.env.BL_REGION ?? "us-was-1";
  const lifecycle = new BoundedLifecycle(new BlaxelRuntimeAdapter(), {
    region,
    image: process.env.BL_SANDBOX_IMAGE ?? "blaxel/base-image:latest",
    sandboxTtl: process.env.BL_SANDBOX_TTL ?? "1h",
  });

  beforeAll(async () => {
    const driveName = driveNameForAgent(agentId);
    await deleteDriveIfExists(driveName);
    await DriveInstance.create({
      name: driveName,
      region,
      labels: { "test-purpose": "permission-reconciliation" },
      permissions: [],
    });
  });

  afterAll(async () => {
    await deleteDriveIfExists(driveNameForAgent(agentId));
  });

  it("writes with one Sandbox and recovers with a second Sandbox", async () => {
    const identity = { labels: { "agent-id": agentId } };

    await lifecycle.invoke({
      agentId,
      invocationId: "write",
      identity,
      command: "printf 'durable-result' > /data/result.txt",
      timeoutSeconds: 30,
    });

    const staleInvocationId = "read";
    await SandboxInstance.createIfNotExists({
      name: sandboxNameForInvocation(agentId, staleInvocationId),
      region,
      image: process.env.BL_SANDBOX_IMAGE ?? "blaxel/base-image:latest",
      ttl: "1h",
      labels: {
        "agent-id": agentId,
        "lifecycle-config": "stale",
      },
    });

    const result = await lifecycle.invoke({
      agentId,
      invocationId: staleInvocationId,
      identity,
      command: "cat /data/result.txt",
      timeoutSeconds: 30,
    });

    expect(result.logs).toContain("durable-result");

    const drive = await DriveInstance.get(driveNameForAgent(agentId));
    expect(drive.permissions).toEqual([
      {
        labels: { "agent-id": agentId },
        mode: "read-write",
        path: "/",
      },
    ]);
  }, 180_000);

  it("auto-kills a timed-out process and removes its Sandbox", async () => {
    const invocationId = "timeout";
    await expect(
      lifecycle.invoke({
        agentId,
        invocationId,
        identity: { labels: { "agent-id": agentId } },
        command: "sleep 10",
        timeoutSeconds: 1,
      }),
    ).rejects.toBeDefined();

    const sandboxStatus = await SandboxInstance.get(
      sandboxNameForInvocation(agentId, invocationId),
    )
      .then((sandbox) => sandbox.status)
      .catch((error: unknown) => {
        if (isBlaxelWorkloadNotFound(error)) {
          return "WORKLOAD_NOT_FOUND";
        }
        throw error;
      });

    expect([
      "DELETING",
      "TERMINATING",
      "TERMINATED",
      "WORKLOAD_NOT_FOUND",
    ]).toContain(sandboxStatus);
  }, 180_000);
});

async function deleteDriveIfExists(name: string): Promise<void> {
  try {
    await DriveInstance.delete(name);
  } catch (error) {
    if (!isBlaxelWorkloadNotFound(error)) throw error;
  }
}
