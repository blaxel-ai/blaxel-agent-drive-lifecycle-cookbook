import "dotenv/config";
import { DriveInstance } from "@blaxel/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  BlaxelRuntimeAdapter,
  BoundedLifecycle,
  driveNameForAgent,
  isBlaxelWorkloadNotFound,
} from "../index.js";

const describeLiveNetwork =
  process.env.RUN_BLAXEL_NETWORK_TESTS === "1" ? describe : describe.skip;
const agentId = `cookbook-network-${Date.now()}`;

describeLiveNetwork("Blaxel Sandbox domain filtering", () => {
  const lifecycle = new BoundedLifecycle(new BlaxelRuntimeAdapter(), {
    region: process.env.BL_REGION ?? "us-was-1",
    image: process.env.BL_SANDBOX_IMAGE ?? "blaxel/base-image:latest",
    sandboxTtl: process.env.BL_SANDBOX_TTL ?? "1h",
  });

  afterAll(async () => {
    await deleteDriveIfExists(driveNameForAgent(agentId));
  });

  it("allows the approved domain and blocks another proxy-aware request", async () => {
    const result = await lifecycle.invoke({
      agentId,
      invocationId: `network-${Date.now()}`,
      identity: { labels: { "agent-id": agentId } },
      network: { allowedDomains: ["example.com"] },
      command: `set -eu
curl --fail --silent --show-error --max-time 15 https://example.com >/dev/null
if curl --fail --silent --show-error --max-time 10 https://www.cloudflare.com >/dev/null 2>&1; then
  printf '%s\n' 'unexpectedly allowed' >&2
  exit 42
fi
printf '%s\n' 'blocked'`,
      timeoutSeconds: 45,
    });

    expect(result.logs).toContain("blocked");
  }, 180_000);
});

async function deleteDriveIfExists(name: string): Promise<void> {
  try {
    await DriveInstance.delete(name);
  } catch (error) {
    if (!isBlaxelWorkloadNotFound(error)) throw error;
  }
}
