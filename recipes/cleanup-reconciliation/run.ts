import "dotenv/config";
import { Pool } from "pg";
import {
  BlaxelRuntimeAdapter,
  CleanupReconciler,
  OpenTelemetryLifecycleObserver,
  PostgresLifecycleCoordinator,
  startExternalObservability,
} from "../index.js";

const telemetry = startExternalObservability("agent-drive-cleanup-reconciler");
const pool = new Pool({ connectionString: required("LIFECYCLE_DATABASE_URL") });
const coordinator = new PostgresLifecycleCoordinator(pool);
const reconciler = new CleanupReconciler(
  new BlaxelRuntimeAdapter(),
  coordinator,
  new OpenTelemetryLifecycleObserver(),
);

try {
  const gracePeriodMs = Number(
    process.env.CLEANUP_GRACE_PERIOD_MS ?? 3_600_000,
  );
  const result = await reconciler.runOnce({
    olderThan: new Date(Date.now() - gracePeriodMs),
    limit: Number(process.env.CLEANUP_BATCH_SIZE ?? 100),
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
  await telemetry.shutdown();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
