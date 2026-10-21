# Verification

Automated checks last verified: October 21, 2026, on Node.js 20.20.0 and 22.22.0 (npm 10), after the vite 8.3.5 / vitest 4.1.12 / follow-redirects 1.16.1 dependency update.

Live check last verified: August 12, 2026, on Node.js 24.18.0 with `@blaxel/core` 0.3.11. It was not rerun for the dependency update.

## Automated checks

The repository was verified with the following commands:

```bash
npm ci
npm run check
npm run check:polish
npm ci --prefix recipes
npm run check --prefix recipes
```

These checks cover the TypeScript build, core and recipe unit tests, formatting, and local documentation links. They do not contact Blaxel. `make -C recipes/custom-image test` was not part of the October run.

| Check                             | Result                                                |
| --------------------------------- | ----------------------------------------------------- |
| Core build and unit tests         | Passed: 28 tests; 2 opt-in live tests skipped         |
| Recipe build and unit tests       | Passed: 19 tests; 3 opt-in live tests skipped         |
| Formatting and local links        | Passed                                                |
| Core and recipe dependency audits | Passed: 0 known vulnerabilities (OSV, both lockfiles) |

## Live Blaxel check

The core workspace test was run with:

```bash
npm run test:live
```

It verifies that one Sandbox writes a file to Agent Drive, a different Sandbox recovers it, expected Drive permissions are reconciled, a stale same-name Sandbox is replaced, and a timed-out process is terminated and cleaned up.

Result: passed, 2 tests.

The test creates temporary Blaxel resources and removes its Sandboxes and Agent Drive. Its passing terminal result proves the tested lifecycle calls completed; it is not a durable receipt of deleted resources. Optional custom-image, network, credential, and model recipe live tests were not part of this verification.

The custom Sandbox image smoke test was not run because Docker was unavailable in the verification environment.
