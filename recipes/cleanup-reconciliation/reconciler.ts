import type { LifecycleCoordinator } from "../../src/coordination.js";
import type { LifecycleObserver } from "../../src/observability.js";
import { NoopLifecycleObserver } from "../../src/observability.js";
import type { RuntimeAdapter } from "../../src/types.js";

export type ReconcileResult = {
  inspected: number;
  deleted: number;
  failed: number;
};

export class CleanupReconciler {
  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly coordinator: LifecycleCoordinator,
    private readonly observer: LifecycleObserver = new NoopLifecycleObserver(),
  ) {}

  async runOnce(input: {
    olderThan: Date;
    limit?: number;
  }): Promise<ReconcileResult> {
    const records = await this.coordinator.listPendingCleanup({
      olderThan: input.olderThan,
      limit: input.limit ?? 100,
    });
    const result: ReconcileResult = {
      inspected: records.length,
      deleted: 0,
      failed: 0,
    };

    for (const record of records) {
      try {
        await this.observer.step(
          "reconcile.delete_sandbox",
          {
            sandbox_name: record.sandboxName,
            lifecycle_key: record.lifecycleKey,
          },
          () => this.runtime.deleteSandbox(record.sandboxName),
        );
        await this.coordinator.markSandboxDeleted(record.sandboxName);
        result.deleted += 1;
      } catch (error) {
        await this.coordinator.markCleanupFailed(record.sandboxName, error);
        result.failed += 1;
      }
    }

    return result;
  }
}
