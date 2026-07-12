# InitPad product roadmap

## Positioning

InitPad should win on **time-to-first-deploy for a self-hosted small team**, not
on breadth of integrations. Backstage already offers a large catalog/plugin
ecosystem, configurable software templates, task history/dry runs and TechDocs.
Commercial portals compete on catalogs, scorecards and workflow orchestration.
InitPad's defensible wedge is an opinionated all-in-one path that installs in
one command and includes the actual delivery infrastructure.

Primary users:

1. universities, bootcamps and DevOps courses needing repeatable environments;
2. small internal teams without a dedicated platform engineering group;
3. regulated/on-premise labs that cannot send code to a SaaS control plane;
4. demos and evaluations of promotion/build-once concepts.

Avoid an enterprise claim until the production gates in `THREAT_MODEL.md` are
closed.

## Prioritized demand backlog

### Now — make adoption measurable

- Guided first-run checklist: create project, clone, push, inspect CI, promote.
- Template version and changelog; show framework/runtime versions before create.
- Review step before provisioning and durable provisioning task log/retry.
- Team/owner model, roles (`viewer`, `developer`, `maintainer`, `admin`) and
  approval policy for production promotion.
- Metrics: time to first successful deploy, provisioning success rate, CI lead
  time, deployment frequency, failed-deployment rate and rollback time.

### Next — product differentiation

- Pull-request preview environments with TTL and automatic teardown.
- Remote deployment agent, so the control plane loses its host Docker socket.
- Template conformance contract: schema validation, render test, build/test,
  vulnerability threshold, SBOM and signed image in CI.
- Service ownership/catalog metadata generated alongside every project, plus
  docs-as-code starter content.
- Environment variables and secrets via a real secret-store abstraction.
- Observability page linking logs, metrics, traces and deployment events.

### Later — larger organizations

- Kubernetes provider, policy-as-code and quotas per team.
- Scorecards for golden-path adoption, documentation, SLOs and dependency risk.
- GitHub/GitLab providers behind the existing SCM abstraction.
- SAML/OIDC enterprise identity, SCIM, immutable audit export and HA control
  plane.
- Template marketplace and automated upgrades of generated projects.

## UX acceptance criteria

- A new user reaches a healthy dev URL in under ten minutes without reading a
  runbook.
- Every asynchronous action has persisted progress, cancellation and a useful
  failure/retry path.
- Destructive and production actions show target, artifact hash and impact.
- Mobile width never hides an action; wide tables provide an explicit scroll
  region or card representation.
- Keyboard-only and screen-reader flows cover sign-in, project creation,
  promotion, logs and target setup.

## Evaluation plan for the thesis

Run the same three scenarios manually and through InitPad: create an API,
deliver a code change to dev, and promote the identical artifact to test/prod.
Measure elapsed time, number of manual configuration steps, failure count and
artifact identity. Add a short SUS questionnaire and interview developers about
cognitive load. Compare capabilities and setup cost against a minimal Backstage
installation, while explicitly distinguishing portal/catalog features from
InitPad's included execution layer.

## Market references

- Backstage Software Templates: https://backstage.io/docs/features/software-templates/
- Backstage Software Catalog: https://backstage.io/docs/features/software-catalog/
- Backstage TechDocs: https://backstage.io/docs/features/techdocs/
