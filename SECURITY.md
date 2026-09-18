# Security policy

## Supported versions

InitPad is under active development. Security fixes are provided for the latest
stable release line and for `main` until the next stable release is published.
Older release lines are not maintained unless their release notes explicitly
say otherwise.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, log or
deployment screenshot. Use
[GitHub private vulnerability reporting](https://github.com/kudrle01/initpad/security/advisories/new)
and include:

- the affected version or commit;
- the smallest reproducible scenario;
- the expected and observed security boundary;
- the potential impact;
- any suggested mitigation, if known.

Do not include production credentials or data belonging to another user. The
maintainer aims to acknowledge a complete report within seven days. A fix and
coordinated disclosure date depend on severity and reproducibility.

## Security boundaries

The self-hosted profile assumes one trusted organization and a trusted host
administrator. Workspace authorization isolates application data and actions,
but containers on one Docker daemon share its host kernel. Do not use the
self-hosted profile as hostile multi-tenant isolation without an additional VM,
sandbox or orchestration boundary.

The supported deployment assumptions, Agent trust model and known limitations
are documented in [THREAT_MODEL.md](THREAT_MODEL.md) and
[docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

## Disclosure

After a fix is available, the project may publish a GitHub security advisory
with affected versions, impact, remediation and credit. Reporters may request
embargo coordination or anonymity.
