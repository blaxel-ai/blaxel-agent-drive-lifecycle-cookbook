import { describe, expect, it, vi } from "vitest";
import {
  InMemoryLifecycleCoordinator,
  PostgresLifecycleCoordinator,
  type CleanupRecord,
  type SqlClient,
  type SqlQueryResult,
} from "../index.js";

function sqlClient(rows: Array<Record<string, unknown>> = []) {
  const query = vi
    .fn<
      (
        text: string,
        values?: unknown[],
      ) => Promise<{ rows: Array<Record<string, unknown>> }>
    >()
    .mockResolvedValue({ rows });
  const client: SqlClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<SqlQueryResult<Row>> {
      const result = await query(text, values);
      return { rows: result.rows as Row[] };
    },
  };
  return { client, query };
}

describe("PostgresLifecycleCoordinator", () => {
  it("acquires an atomic lease and maps the returned database row", async () => {
    const { client, query } = sqlClient([
      {
        lease_key: "agent-1:message-1",
        owner_id: "owner-1",
        expires_at: "2026-08-10T12:01:00.000Z",
      },
    ]);
    const coordinator = new PostgresLifecycleCoordinator(client);

    await expect(
      coordinator.acquire({
        key: "agent-1:message-1",
        ownerId: "owner-1",
        ttlMs: 60_000,
      }),
    ).resolves.toEqual({
      key: "agent-1:message-1",
      ownerId: "owner-1",
      expiresAt: new Date("2026-08-10T12:01:00.000Z"),
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (lease_key) DO UPDATE"),
      ["agent-1:message-1", "owner-1", 60_000],
    );
    expect(query.mock.calls[0]?.[0]).not.toContain(
      "agent_lifecycle_leases.owner_id = EXCLUDED.owner_id",
    );
  });

  it("returns no lease when another unexpired owner holds it", async () => {
    const { client } = sqlClient();

    await expect(
      new PostgresLifecycleCoordinator(client).acquire({
        key: "agent-1:message-1",
        ownerId: "owner-2",
        ttlMs: 60_000,
      }),
    ).resolves.toBeNull();
  });

  it("releases a lease only for its recorded owner", async () => {
    const { client, query } = sqlClient();

    await new PostgresLifecycleCoordinator(client).release({
      key: "agent-1:message-1",
      ownerId: "owner-1",
      expiresAt: new Date("2026-08-10T12:01:00.000Z"),
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE lease_key = $1 AND owner_id = $2"),
      ["agent-1:message-1", "owner-1"],
    );
  });

  it("records expected cleanup before Sandbox creation", async () => {
    const { client, query } = sqlClient();
    const record: CleanupRecord = {
      lifecycleKey: "agent-1:message-1",
      sandboxName: "agent-1-message-1",
      agentId: "agent-1",
      invocationId: "message-1",
      createdAt: new Date("2026-08-10T12:00:00.000Z"),
    };

    await new PostgresLifecycleCoordinator(client).expectSandbox(record);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_lifecycle_cleanup"),
      [
        "agent-1-message-1",
        "agent-1:message-1",
        "agent-1",
        "message-1",
        record.createdAt,
        null,
      ],
    );
  });

  it("maps pending cleanup rows without losing failure context", async () => {
    const { client, query } = sqlClient([
      {
        lifecycle_key: "agent-1:message-1",
        sandbox_name: "agent-1-message-1",
        agent_id: "agent-1",
        invocation_id: "message-1",
        created_at: "2026-08-10T12:00:00.000Z",
        last_error: "temporary delete failure",
      },
    ]);
    const coordinator = new PostgresLifecycleCoordinator(client);
    const olderThan = new Date("2026-08-10T12:05:00.000Z");

    await expect(
      coordinator.listPendingCleanup({ olderThan, limit: 25 }),
    ).resolves.toEqual([
      {
        lifecycleKey: "agent-1:message-1",
        sandboxName: "agent-1-message-1",
        agentId: "agent-1",
        invocationId: "message-1",
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        lastError: "temporary delete failure",
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE state = 'pending' AND created_at <= $1"),
      [olderThan, 25],
    );
  });
});

describe("InMemoryLifecycleCoordinator", () => {
  it("does not allow the same owner to acquire one active lease twice", async () => {
    const coordinator = new InMemoryLifecycleCoordinator();
    const input = {
      key: "agent-1:message-1",
      ownerId: "owner-1",
      ttlMs: 60_000,
    };

    await expect(coordinator.acquire(input)).resolves.not.toBeNull();
    await expect(coordinator.acquire(input)).resolves.toBeNull();
  });
});
