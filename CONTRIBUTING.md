# Contributing

Thanks for improving the Agent Drive lifecycle cookbook.

## Before you start

Use an issue for a bug report or focused feature proposal. For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md) instead.

Read the [architecture](docs/architecture.md) before changing resource ownership, Agent Drive permissions, Sandbox replacement, retry behavior, or cleanup semantics. Keep the core example small; application-specific hardening belongs in an optional recipe.

## Local setup and checks

```bash
npm ci
npm run check
npm run check:polish
npm ci --prefix recipes
npm run check --prefix recipes
make -C recipes/custom-image test
```

The opt-in live checks create billable or externally visible Blaxel activity. Run only the checks relevant to your change and record the result and evidence boundary in [docs/verification.md](docs/verification.md).

## Pull requests

Keep each pull request focused. Explain the user-facing change, what you verified, and any compatibility or resource-lifecycle impact.

Do not commit credentials, workspace identifiers, resource URLs, private source, machine-specific paths, generated build output, or temporary test artifacts.
