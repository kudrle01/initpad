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

## Automated security checks

The repository is checked continuously, not only when it changes:

| Check | Scope | When |
| --- | --- | --- |
| CodeQL (`security-extended`) | TypeScript, template Python, GitHub Actions workflows | every pull request and push to `main`, weekly |
| Dependency review | dependencies added or changed by a pull request; fails on moderate or higher | every pull request |
| `npm audit` release gate | production npm dependencies, with exceptions in `security/npm-audit-exceptions.json` | every pull request and push to `main`, daily |
| Trivy | platform and template container images and template dependencies | when images change, weekly |
| Gitleaks | complete Git history | every pull request and push to `main` |
| GitHub secret scanning and push protection | pushed commits | every push |
| Dependabot security updates | npm, pip, Composer, Docker and GitHub Actions | as soon as an advisory is published |
| Dependabot version updates | the same ecosystems, majors planned by hand | weekly, on Monday |
| Dependabot auto-merge | patch and minor updates outside container images, once the required checks pass | every Dependabot pull request |
| OpenSSF Scorecard | repository and supply-chain practices | push to `main`, weekly |

Findings appear under the repository's **Security** tab. An alert that cannot be
fixed yet, for example because no patched version exists, is dismissed with a
recorded reason and revisited when Dependabot reports a fix. The same
exception, with an expiry date, is listed in `osv-scanner.toml` for OSV-based
tools such as the Scorecard Vulnerabilities check.
