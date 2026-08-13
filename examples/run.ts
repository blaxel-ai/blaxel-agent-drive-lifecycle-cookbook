import "dotenv/config";
import { settings } from "@blaxel/core";
import {
  BlaxelRuntimeAdapter,
  BoundedLifecycle,
  driveNameForAgent,
  sandboxNameForInvocation,
} from "../src/core.js";

const agentId = process.env.AGENT_ID ?? "demo-agent";
const runId = Date.now();
const writeInvocationId = `write-${runId}`;
const readInvocationId = `read-${runId}`;
const checkpointPath = "/data/checkpoint.md";
const driveName = driveNameForAgent(agentId);
const firstSandboxName = sandboxNameForInvocation(agentId, writeInvocationId);
const secondSandboxName = sandboxNameForInvocation(agentId, readInvocationId);
const lifecycle = new BoundedLifecycle(new BlaxelRuntimeAdapter(), {
  region: process.env.BL_REGION ?? "us-was-1",
  image: process.env.BL_SANDBOX_IMAGE ?? "blaxel/base-image:latest",
  memoryMb: Number(process.env.BL_SANDBOX_MEMORY_MB ?? "2048"),
  sandboxTtl: process.env.BL_SANDBOX_TTL ?? "1h",
  mountPath: process.env.BL_MOUNT_PATH ?? "/data",
});

console.log(`Drive: ${driveName}`);
console.log(`First Sandbox: ${firstSandboxName}`);

await lifecycle.invoke({
  agentId,
  invocationId: writeInvocationId,
  identity: { labels: { "agent-id": agentId } },
  command: [
    "printf '%s\\n'",
    "'# Agent checkpoint'",
    "''",
    "'Task: Verify durable state across invocations'",
    "'Completed: Wrote this checkpoint from the first Sandbox'",
    "'Next: Read it from a new Sandbox and continue'",
    `> ${checkpointPath}`,
  ].join(" "),
});

console.log(`Wrote ${checkpointPath}`);
console.log("First Sandbox deleted");
console.log();
console.log(`Second Sandbox: ${secondSandboxName}`);

const second = await lifecycle.invoke({
  agentId,
  invocationId: readInvocationId,
  identity: { labels: { "agent-id": agentId } },
  command: `cat ${checkpointPath}`,
});

console.log(`Mounted same Drive: ${driveName}`);
console.log(`Recovered ${checkpointPath}:`);
console.log(second.logs.trim());
console.log("Second Sandbox deleted");
console.log(`Drive retained: ${driveName}`);

const workspace = settings.workspace;
const workspacePath = encodeURIComponent(workspace);
const drivePath = encodeURIComponent(driveName);

console.log();
console.log("Inspect the proof:");
console.log(
  `Retained Drive in Blaxel: https://app.blaxel.ai/${workspacePath}/global-agentic-network/drive/${drivePath}`,
);
console.log(
  `Sandbox inventory in Blaxel: https://app.blaxel.ai/${workspacePath}/global-agentic-network/sandboxes`,
);
console.log(`CLI verification: bl drive get ${driveName}`);
console.log(
  "How Agent Drive works: https://docs.blaxel.ai/Agent-drive/Overview",
);
