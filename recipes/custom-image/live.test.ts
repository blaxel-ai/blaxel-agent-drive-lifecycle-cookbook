import "dotenv/config";
import { DriveInstance } from "@blaxel/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  BlaxelRuntimeAdapter,
  BoundedLifecycle,
  driveNameForAgent,
  isBlaxelWorkloadNotFound,
} from "../index.js";

const describeLiveImage =
  process.env.RUN_BLAXEL_CUSTOM_IMAGE_TESTS === "1" ? describe : describe.skip;
const agentId = `cookbook-image-${Date.now()}`;

describeLiveImage("Blaxel custom image", () => {
  afterAll(async () => {
    await deleteDriveIfExists(driveNameForAgent(agentId));
  });

  it("runs workload commands as the non-root agent user", async () => {
    const lifecycle = new BoundedLifecycle(new BlaxelRuntimeAdapter(), {
      region: process.env.BL_REGION ?? "us-was-1",
      image: required("BL_SANDBOX_IMAGE"),
      sandboxTtl: process.env.BL_SANDBOX_TTL ?? "1h",
    });
    const result = await lifecycle.invoke({
      agentId,
      invocationId: `non-root-${Date.now()}`,
      identity: { labels: { "agent-id": agentId } },
      command: 'test "$(id -u)" != 0 && printf non-root',
      timeoutSeconds: 30,
    });

    expect(result.logs).toContain("non-root");
  }, 180_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function deleteDriveIfExists(name: string): Promise<void> {
  try {
    await DriveInstance.delete(name);
  } catch (error) {
    if (!isBlaxelWorkloadNotFound(error)) throw error;
  }
}
