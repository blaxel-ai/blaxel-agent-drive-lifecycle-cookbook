export type Lease = {
  key: string;
  ownerId: string;
  expiresAt: Date;
};

export type CleanupRecord = {
  lifecycleKey: string;
  sandboxName: string;
  agentId: string;
  invocationId: string;
  createdAt: Date;
  lastError?: string;
};

export interface LifecycleCoordinator {
  acquire(input: {
    key: string;
    ownerId: string;
    ttlMs: number;
  }): Promise<Lease | null>;
  release(lease: Lease): Promise<void>;
  expectSandbox(record: CleanupRecord): Promise<void>;
  markSandboxDeleted(sandboxName: string): Promise<void>;
  markCleanupFailed(sandboxName: string, error: unknown): Promise<void>;
  listPendingCleanup(input: {
    olderThan: Date;
    limit: number;
  }): Promise<CleanupRecord[]>;
}

export class NoopLifecycleCoordinator implements LifecycleCoordinator {
  async acquire(input: {
    key: string;
    ownerId: string;
    ttlMs: number;
  }): Promise<Lease> {
    return {
      key: input.key,
      ownerId: input.ownerId,
      expiresAt: new Date(Date.now() + input.ttlMs),
    };
  }

  async release(_lease: Lease): Promise<void> {}
  async expectSandbox(_record: CleanupRecord): Promise<void> {}
  async markSandboxDeleted(_sandboxName: string): Promise<void> {}
  async markCleanupFailed(
    _sandboxName: string,
    _error: unknown,
  ): Promise<void> {}
  async listPendingCleanup(_input: {
    olderThan: Date;
    limit: number;
  }): Promise<CleanupRecord[]> {
    return [];
  }
}
