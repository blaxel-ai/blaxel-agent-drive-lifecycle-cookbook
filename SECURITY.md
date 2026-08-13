# Security

## Reporting a vulnerability

Report suspected vulnerabilities through the repository's Security tab using private vulnerability reporting when available. Otherwise, contact the Blaxel security owner through the current internal security process. Do not open a public issue containing credentials, workspace details, private source, resource URLs, or an active exploit.

Security fixes are maintained on the default branch. This cookbook is an example implementation rather than a supported hosted service; applications adopting it remain responsible for their own threat model and operational controls.

## Scope

Security-sensitive areas include Blaxel authentication, Agent Drive permissions, Sandbox environment and command execution, mount verification, network and credential recipes, resource naming, and cleanup behavior.

The core example keeps Blaxel credentials in the orchestration process and does not copy them into Sandbox commands or environment variables. These controls reduce risk but do not replace review of application commands, identities, permissions, retention, and any optional recipe before production use.
