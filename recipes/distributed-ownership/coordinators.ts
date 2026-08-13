import type {
  CleanupRecord,
  Lease,
  LifecycleCoordinator,
} from "../../src/coordination.js";

/** Single-process coordinator for recipe tests and local exploration. */
export class InMemoryLifecycleCoordinator implements LifecycleCoordinator {
  private readonly leases = new Map<string, Lease>();
  private readonly cleanup = new Map<string, CleanupRecord>();

  async acquire(input: {
    key: string;
    ownerId: string;
    ttlMs: number;
  }): Promise<Lease | null> {
    const existing = this.leases.get(input.key);
    if (existing && existing.expiresAt.getTime() > Date.now()) return null;

    const lease = {
      key: input.key,
      ownerId: input.ownerId,
      expiresAt: new Date(Date.now() + input.ttlMs),
    };
    this.leases.set(input.key, lease);
    return lease;
  }

  async release(lease: Lease): Promise<void> {
    const current = this.leases.get(lease.key);
    if (current?.ownerId === lease.ownerId) this.leases.delete(lease.key);
  }

  async expectSandbox(record: CleanupRecord): Promise<void> {
    this.cleanup.set(record.sandboxName, { ...record });
  }

  async markSandboxDeleted(sandboxName: string): Promise<void> {
    this.cleanup.delete(sandboxName);
  }

  async markCleanupFailed(sandboxName: string, error: unknown): Promise<void> {
    const record = this.cleanup.get(sandboxName);
    if (record) record.lastError = errorMessage(error);
  }

  async listPendingCleanup(input: {
    olderThan: Date;
    limit: number;
  }): Promise<CleanupRecord[]> {
    return [...this.cleanup.values()]
      .filter((record) => record.createdAt <= input.olderThan)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .slice(0, input.limit)
      .map((record) => ({ ...record }));
  }
}

export type SqlQueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface SqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

type LeaseRow = {
  lease_key: string;
  owner_id: string;
  expires_at: Date | string;
};

type CleanupRow = {
  lifecycle_key: string;
  sandbox_name: string;
  agent_id: string;
  invocation_id: string;
  created_at: Date | string;
  last_error: string | null;
};

export class PostgresLifecycleCoordinator implements LifecycleCoordinator {
  constructor(private readonly sql: SqlClient) {}

  async acquire(input: {
    key: string;
    ownerId: string;
    ttlMs: number;
  }): Promise<Lease | null> {
    const result = await this.sql.query<LeaseRow>(
      `INSERT INTO agent_lifecycle_leases (lease_key, owner_id, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
       ON CONFLICT (lease_key) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           expires_at = EXCLUDED.expires_at
       WHERE agent_lifecycle_leases.expires_at <= NOW()
       RETURNING lease_key, owner_id, expires_at`,
      [input.key, input.ownerId, input.ttlMs],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      key: row.lease_key,
      ownerId: row.owner_id,
      expiresAt: new Date(row.expires_at),
    };
  }

  async release(lease: Lease): Promise<void> {
    await this.sql.query(
      `DELETE FROM agent_lifecycle_leases
       WHERE lease_key = $1 AND owner_id = $2`,
      [lease.key, lease.ownerId],
    );
  }

  async expectSandbox(record: CleanupRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO agent_lifecycle_cleanup
         (sandbox_name, lifecycle_key, agent_id, invocation_id, created_at, state, last_error)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       ON CONFLICT (sandbox_name) DO UPDATE
       SET lifecycle_key = EXCLUDED.lifecycle_key,
           agent_id = EXCLUDED.agent_id,
           invocation_id = EXCLUDED.invocation_id,
           state = 'pending',
           last_error = EXCLUDED.last_error,
           updated_at = NOW()`,
      [
        record.sandboxName,
        record.lifecycleKey,
        record.agentId,
        record.invocationId,
        record.createdAt,
        record.lastError ?? null,
      ],
    );
  }

  async markSandboxDeleted(sandboxName: string): Promise<void> {
    await this.sql.query(
      `UPDATE agent_lifecycle_cleanup
       SET state = 'deleted', last_error = NULL, updated_at = NOW()
       WHERE sandbox_name = $1`,
      [sandboxName],
    );
  }

  async markCleanupFailed(sandboxName: string, error: unknown): Promise<void> {
    await this.sql.query(
      `UPDATE agent_lifecycle_cleanup
       SET state = 'pending', last_error = $2, updated_at = NOW()
       WHERE sandbox_name = $1`,
      [sandboxName, errorMessage(error)],
    );
  }

  async listPendingCleanup(input: {
    olderThan: Date;
    limit: number;
  }): Promise<CleanupRecord[]> {
    const result = await this.sql.query<CleanupRow>(
      `SELECT lifecycle_key, sandbox_name, agent_id, invocation_id, created_at, last_error
       FROM agent_lifecycle_cleanup
       WHERE state = 'pending' AND created_at <= $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [input.olderThan, input.limit],
    );

    return result.rows.map((row) => ({
      lifecycleKey: row.lifecycle_key,
      sandboxName: row.sandbox_name,
      agentId: row.agent_id,
      invocationId: row.invocation_id,
      createdAt: new Date(row.created_at),
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
    }));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
