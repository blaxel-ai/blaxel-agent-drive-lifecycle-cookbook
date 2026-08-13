# Agent Drive lifecycle cookbook

[![CI](https://github.com/blaxel-ai/blaxel-agent-drive-lifecycle-cookbook/actions/workflows/ci.yml/badge.svg)](https://github.com/blaxel-ai/blaxel-agent-drive-lifecycle-cookbook/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/blaxel-ai/blaxel-agent-drive-lifecycle-cookbook)](LICENSE)

Keep an agent's files across invocations without keeping its compute alive.

This cookbook creates or reuses one Blaxel Agent Drive for an agent, mounts it into an invocation Sandbox, writes an artifact, deletes the Sandbox, then mounts the same Drive into a new Sandbox and reads the artifact back.

> **Availability:** [Agent Drive](https://blaxel.ai/agent-drive) is currently in private preview in `us-was-1`. Request access before running the example. The Drive and every Sandbox that mounts it must use that region.

## Run the lifecycle

Prerequisites:

- Node.js 20 or later
- a [Blaxel account](https://app.blaxel.ai/login?mode=signup&utm_source=github&utm_medium=referral&utm_campaign=agent_drive_lifecycle_cookbook) and the [Blaxel CLI](https://docs.blaxel.ai/cli-reference/introduction) authenticated with `bl login`
- Agent Drive access in the target workspace

```bash
npm install
bl login
npm run example
```

The generated resource names vary by run. The output follows this shape:

```text
Drive: agent-drive-demo-agent-...
First Sandbox: agent-msg-demo-agent-write-...
Wrote /data/checkpoint.md
First Sandbox deleted

Second Sandbox: agent-msg-demo-agent-read-...
Mounted same Drive: agent-drive-demo-agent-...
Recovered /data/checkpoint.md:
# Agent checkpoint

Task: Verify durable state across invocations
Completed: Wrote this checkpoint from the first Sandbox
Next: Read it from a new Sandbox and continue
Second Sandbox deleted
Drive retained: agent-drive-demo-agent-...

Inspect the proof:
Retained Drive in Blaxel: https://app.blaxel.ai/<workspace>/global-agentic-network/drive/agent-drive-demo-agent-...
Sandbox inventory in Blaxel: https://app.blaxel.ai/<workspace>/global-agentic-network/sandboxes
CLI verification: bl drive get agent-drive-demo-agent-...
How Agent Drive works: https://docs.blaxel.ai/Agent-drive/Overview
```

Blaxel credentials stay in the orchestration process. The example does not copy them into the Sandbox environment or command.

The terminal recovery is the proof that a new Sandbox read the file written by the first one. The retained Drive link opens the durable resource in Blaxel so you can inspect its status, region, labels, and configuration. The Sandbox inventory lets you inspect the workspace's current compute state; the two invocation Sandboxes are deleted by the lifecycle and may no longer have detail pages.

## Clean up the retained Drive

The lifecycle intentionally retains the Agent Drive so you can inspect or reuse the recovered checkpoint. When you are finished, copy any files you want to keep, then use the exact Drive name printed by the example to review and delete it:

```bash
bl drive get <drive-name>
bl drive delete <drive-name>
```

Drive deletion is permanent. The example does not run this cleanup automatically.

## Run with your AI coding harness

If you use Claude Code, Codex, ChatGPT, or another AI coding assistant with access to this repository and a terminal, open the repository as its workspace and paste the following prompt:

```text
Review this repository and help me experience the core Agent Drive lifecycle.

1. Read README.md, examples/run.ts, src/lifecycle.ts, and src/blaxel-runtime.ts before acting. Do not change the source files.
2. Check that Node.js 20 or later and the Blaxel CLI are installed, `bl` is authenticated, and the target region is `us-was-1`. Never ask me to paste credentials or print them in commands or logs.
3. Explain which Blaxel resources the smallest example will create, which ones it deletes, and which one it retains.
4. Install the dependencies with `npm install`, then run `npm run example`.
5. Verify that the output shows two different Sandbox names, both Sandboxes being deleted, the same Drive name for both invocations, and the contents of `/data/checkpoint.md` recovered by the second Sandbox.
6. Explain the aha moment in plain language: the first Sandbox writes an agent checkpoint and is deleted; a second Sandbox mounts the same Agent Drive and recovers the task state. Durable files belong to the agent while compute belongs to the invocation.
7. End with a concise proof trail. Quote the checkpoint recovery from the terminal, include the clickable links printed by the example for the retained Drive and Sandbox inventory, include the exact `bl drive get` verification command, and link to the Agent Drive documentation. Explain that the terminal proves file recovery, the Drive page proves the retained resource and its configuration, and the Sandbox inventory shows the workspace's current compute state. Do not claim the console alone proves the recovered file, and do not expect deleted Sandboxes to retain working detail pages.
8. If anything fails, identify the exact missing prerequisite and give me the smallest next action. Do not run optional recipes or opt-in live tests, and do not delete the Agent Drive unless I ask.
```

The example creates or reuses one persistent Agent Drive and creates two short-lived Sandboxes in your Blaxel workspace.

## Lifecycle

1. Ensure the agent's Drive exists with the expected workload permissions.
2. Create an invocation Sandbox with a maximum-age TTL as a cleanup backstop.
3. Mount the Drive at `/data`.
4. Run one command with an enforced timeout of up to 60 seconds.
5. Delete the Sandbox while retaining the Drive.
6. Mount the same Drive into the next invocation Sandbox.

The smallest runnable path is [examples/run.ts](examples/run.ts). The reusable lifecycle is implemented in [src/lifecycle.ts](src/lifecycle.ts), with the Blaxel SDK adapter in [src/blaxel-runtime.ts](src/blaxel-runtime.ts).

Read [the architecture](docs/architecture.md) for lifecycle invariants, failure behavior, and the tradeoff behind deleting invocation compute.

## Responsibility boundary

| Blaxel provides                                                                      | The application decides                                                                                            | This cookbook illustrates                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Sandboxes, process execution, TTLs, Agent Drive, mounting, permissions, and SDK APIs | Agent identity, invocation identity, workload command, retention policy, and whether to retain or delete a Sandbox | Deterministic naming, permission reconciliation, bounded retries, stale Sandbox replacement, and cleanup behavior |

The core lifecycle does not require Model Gateway, Postgres, a custom image, an external telemetry collector, or the example credential issuer.

## Explore optional application hardening recipes

The core lifecycle ends with the Drive recovery proof. Application-owned layers such as a custom image, network and credential policy, model orchestration, distributed ownership, cleanup reconciliation, and external observability live under [recipes](recipes/README.md) with separate dependencies and validation.

Add only the recipes your workload requires. The combined reference is an integration boundary example, not a starter architecture or a production-ready application.

## Validate the contracts

Install the core dependencies, then run the core local suite:

```bash
npm install
npm run check
npm run check:polish
```

The polish check validates repository formatting and local documentation links.

The opt-in core workspace check creates billable or externally visible activity:

```bash
npm run test:live
```

See the [verification record](docs/verification.md) for the latest tested scope and evidence boundary.

Optional recipes have their own installation, checks, and opt-in live tests in [recipes/README.md](recipes/README.md).

## Boundaries

- This cookbook demonstrates a fresh-compute lifecycle. Blaxel Sandboxes can instead remain in standby when preserving the full machine state and resume speed matter more than a fresh invocation boundary.
- Synchronous command waits are limited to 60 seconds. Use an asynchronous process workflow for longer tasks.
- Sandbox `ttl` is maximum age from creation, regardless of activity. Use a `ttl-idle` lifecycle policy when deletion should be based on inactivity.
- Agent Drive is private preview in `us-was-1`. Proxy routing, secret injection, and domain filtering are public preview and are not recommended for production use in the current public documentation.
- Optional recipes contain application-owned reference implementations. Review each recipe's credential issuer, lease behavior, telemetry, image provenance, and cleanup operations before adapting it.

## References

- [Agent Drive overview](https://docs.blaxel.ai/Agent-drive/Overview)
- [Agent Drive permissions](https://docs.blaxel.ai/Agent-drive/Permissions)
- [Sandbox process execution](https://docs.blaxel.ai/Sandboxes/Processes)
- [Sandbox lifecycle best practices](https://docs.blaxel.ai/Sandboxes/best-practices)
- [Sandbox images](https://docs.blaxel.ai/Sandboxes/Templates)
- [Sandbox proxy](https://docs.blaxel.ai/Sandboxes/Proxy)
- [Blaxel TypeScript SDK](https://github.com/blaxel-ai/sdk-typescript)
- [SDK test: Drive persistence across Sandboxes](https://github.com/blaxel-ai/sdk-typescript/blob/e96ab8e355576dcaff88294c9d3098cb8ab20c9f/tests/integration/sandbox/drives.test.ts#L402-L464)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
