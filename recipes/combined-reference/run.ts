import "dotenv/config";
import { Pool } from "pg";
import {
  BlaxelModelGatewayOrchestrator,
  BlaxelRuntimeAdapter,
  BoundedLifecycle,
  ExampleHmacCredentialBroker,
  OpenTelemetryLifecycleObserver,
  PostgresLifecycleCoordinator,
  ProductionLifecycle,
  startExternalObservability,
  WorkloadRegistry,
} from "../index.js";
import { analysisWorkload } from "./analysis-workload.js";

const telemetry = startExternalObservability();
const workspace = required("BL_WORKSPACE");
const apiKey = required("BL_API_KEY");
const apiDomain = required("APP_API_DOMAIN");
const apiPath = process.env.APP_API_PATH ?? "/v1/records";
const pool = new Pool({ connectionString: required("LIFECYCLE_DATABASE_URL") });
const coordinator = new PostgresLifecycleCoordinator(pool);
const observer = new OpenTelemetryLifecycleObserver();
const lifecycle = new BoundedLifecycle(
  new BlaxelRuntimeAdapter(),
  {
    region: process.env.BL_REGION ?? "us-was-1",
    image: required("BL_SANDBOX_IMAGE"),
    sandboxTtl: process.env.BL_SANDBOX_TTL ?? "1h",
    mountPath: process.env.BL_MOUNT_PATH ?? "/data",
  },
  { coordinator, observer },
);
const production = new ProductionLifecycle(
  lifecycle,
  new BlaxelModelGatewayOrchestrator({
    endpoint: required("BL_MODEL_ENDPOINT"),
    workspace,
    apiKey,
  }),
  new WorkloadRegistry([analysisWorkload(apiDomain, apiPath)]),
  new ExampleHmacCredentialBroker(required("APP_TOKEN_SIGNING_KEY")),
  coordinator,
  { ownerId: process.env.LIFECYCLE_OWNER_ID ?? "orchestrator-1" },
);

try {
  const result = await production.invoke({
    agentId: process.env.AGENT_ID ?? "demo-agent",
    invocationId: `message-${Date.now()}`,
    request: "How many records are available?",
    identity: {
      labels: { "agent-id": process.env.AGENT_ID ?? "demo-agent" },
    },
  });

  console.log(result.answer);
} finally {
  await pool.end();
  await telemetry.shutdown();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
