# Optional application hardening recipes

The core Drive-and-Sandbox lifecycle runs without these components. Add a recipe only when the workload has the corresponding requirement.

Install and validate the core cookbook from the repository root first. Then install these separate recipe dependencies:

```bash
cd recipes
npm install
npm run check
```

## Ownership map

| Capability                 | Blaxel surface                | Application responsibility                            | Cookbook component                                       |
| -------------------------- | ----------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| Durable files              | Agent Drive                   | Agent identity, retention, and permission policy      | Deterministic Drive naming and permission reconciliation |
| Invocation compute         | Sandbox                       | Image, resources, lifecycle, and workload command     | Bounded creation, mount, execution, and deletion         |
| Network and secret routing | Sandbox proxy, public preview | Approved destinations and application credentials     | Policy builder and proxy route shape                     |
| Model access               | Model Gateway                 | Model choice, prompt, and allowed workload catalog    | Reviewed workload selector                               |
| Workload telemetry         | Native Blaxel logs and traces | Retention, dashboards, alerts, and incident ownership | Optional external orchestrator OTLP adapter              |
| Distributed orchestration  | Application infrastructure    | Ownership, lease duration, renewal, and cancellation  | Fixed-duration Postgres lease example                    |
| Cleanup repair             | Sandbox API and TTL           | Reconciliation schedule and alerting                  | Postgres cleanup journal and reconciler example          |

## Custom image

Use a custom image when the workload needs reviewed tools, dependencies, or non-root execution. The included image starts the Sandbox API with `--user agent`, so workload processes run as the unprivileged `agent` user.

```bash
make -C custom-image test
cd custom-image
bl push
```

Set `BL_SANDBOX_IMAGE` to the returned image ID. The Dockerfile pins its Node base and Sandbox API source by immutable digest. Treat digest updates as reviewed dependency changes and keep the built image private to the intended workspace unless sharing is deliberate.

## Network policy and credential injection

Use this recipe when a workload must call approved external services without receiving the raw credential.

`WorkloadRegistry` binds the command, allowed domains, and optional credential destination to a reviewed workload ID. `buildInvocationNetworkPolicy` verifies that the credential audience matches the declared destination before placing it in a write-only proxy route.

Before creating a Sandbox with this policy, `BlaxelRuntimeAdapter` checks `/configuration` and fails fast unless Proxy is available in the selected region. Successful checks are cached per adapter and region. The check does not run for the core lifecycle when no network policy is requested.

The public Blaxel documentation currently marks proxy routing, secret injection, and domain filtering as public preview and not recommended for production use. Domain filtering also depends on tools respecting standard proxy environment variables. Treat this recipe as an integration pattern until the capability reaches the readiness required by the workload.

`ExampleHmacCredentialBroker` exists only to exercise the integration contract in tests and local exploration. It is not an application identity system. A production application should implement `CredentialBroker` with its own issuer, secure key management, narrow permissions, expiry, revocation, verification, and auditing.

## External observability

Use this recipe only when the orchestrator runs outside Blaxel and must export lifecycle telemetry to an existing OTLP/HTTP collector.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20replace-me
```

`OpenTelemetryLifecycleObserver` records lifecycle step duration and outcome. `startExternalObservability` configures transport. The application still owns collector availability, retention, dashboards, alerts, and incident response.

Blaxel-hosted workloads have native logging and tracing through `@blaxel/telemetry`. Do not initialize both telemetry paths without deciding how they compose.

## Distributed lifecycle ownership

Use this recipe when more than one orchestrator can claim the same agent and invocation.

```bash
psql "$LIFECYCLE_DATABASE_URL" -f distributed-ownership/001_lifecycle.sql
```

`PostgresLifecycleCoordinator` acquires one atomic lease per agent and invocation. The example lease has a fixed duration and no renewal loop. Set the duration above the maximum orchestration time or add renewal, ownership-loss detection, and cancellation before supporting longer work.

Postgres is application infrastructure in this recipe. It is not required to create, retain, resume, or delete a Blaxel Sandbox.

## Cleanup reconciliation

Use this recipe when Sandbox cleanup must survive request-process failure.

The cleanup journal records the expected Sandbox before creation. A separately scheduled reconciler retries deletion after a grace period. Blaxel TTL is a maximum age from Sandbox creation and remains a backstop rather than evidence that the application's explicit cleanup completed. Use a `ttl-idle` lifecycle policy instead when expiration should follow inactivity.

```bash
npm run reconcile
```

Alert when cleanup remains pending across multiple runs.

## Model orchestration

Use this recipe when a model should choose among reviewed workloads. It is not required for the Drive lifecycle.

The Model Gateway request includes workload IDs and descriptions. The model returns one ID. `WorkloadRegistry` resolves that ID to a fixed command and policy, so the model cannot create a shell command.

Set `BL_MODEL_ENDPOINT` to a Model Gateway endpoint implementing `/v1/chat/completions`. An externally hosted orchestrator should authenticate with a workspace-scoped service account. Blaxel-hosted workloads use their platform identity.

## Combined reference

The combined reference composes the recipes to expose their integration boundaries. It is not a starter architecture or a production-ready application.

```bash
cp .env.example .env
npm run example:combined
```

Run the reconciler as a separate process:

```bash
npm run reconcile
```

The opt-in live checks validate only the features configured in the target workspace:

```bash
npm run test:live:image
npm run test:live:network
npm run test:live:model
```

The core lifecycle live test remains in the repository root as `npm run test:live`.
