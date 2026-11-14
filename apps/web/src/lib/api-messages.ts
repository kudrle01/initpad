import { msg, t, type MessageKey } from '@/i18n';

/**
 * The API answers in English and has no error codes (ADR-185). This catalog
 * maps the messages users meet most often to dictionary keys, so the Czech UI
 * can show them translated. Named groups become `{placeholders}` of the key; a
 * group called `detail` is itself translated, because the API nests one
 * message inside another ("Cleanup failed: <reason>"). A message that matches
 * no rule is shown exactly as the API sent it.
 *
 * Every key is the English message with its variable parts replaced by
 * placeholders, so in English the translation reproduces the original text.
 */
interface Rule {
  pattern: RegExp;
  key: MessageKey;
}

const NAME = String.raw`'(?<name>[^']+)'`;
const ENV = String.raw`'(?<env>[^']+)'`;

function rule(source: string, key: MessageKey): Rule {
  return { pattern: new RegExp(`^${source}$`), key };
}

/** Escapes a literal message so it can be used as a rule source. */
function exact(key: MessageKey): Rule {
  return rule(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), key);
}

export const API_MESSAGE_RULES: readonly Rule[] = [
  // ------------------------------------------------------------- not found
  exact(msg('Workspace not found')),
  rule(`Project ${NAME} not found`, msg("Project '{name}' not found")),
  rule(`Target ${NAME} not found`, msg("Target '{name}' not found")),
  rule(`Environment ${ENV} not found`, msg("Environment '{env}' not found")),
  rule(`Allocation ${NAME} not found`, msg("Allocation '{name}' not found")),
  rule(
    `Provisioning operation ${NAME} not found`,
    msg("Provisioning operation '{name}' not found"),
  ),
  rule(`User ${NAME} not found`, msg("User '{name}' not found")),
  exact(msg('User not found')),
  exact(msg('Workspace member not found')),
  exact(msg('Production request not found')),

  // --------------------------------------------------------- access, roles
  exact(msg('Workspace read access required')),
  exact(msg('Workspace write access required')),
  exact(msg('Workspace maintain access required')),
  exact(msg('Workspace admin access required')),
  exact(msg('Workspace admin access required to manage allocations')),
  exact(msg('Workspace admin access required to manage the Agent')),
  exact(msg('Only the workspace owner can delete it')),
  exact(msg('Only the workspace owner can change the production approval policy')),
  exact(msg('Only the requester can cancel this production request')),
  exact(msg('Workspace owner role cannot be changed')),
  exact(msg('Workspace owner cannot be removed')),
  exact(msg('User is already a workspace member')),
  exact(msg('Create a team workspace before adding other members')),
  exact(msg('Personal workspaces cannot be deleted')),
  exact(msg('Personal workspaces always use self-review')),
  exact(msg('Delete or move all projects and targets before deleting this workspace')),
  rule(
    String.raw`Workspace slug '(?<slug>[^']+)' is already taken`,
    msg("Workspace slug '{slug}' is already taken"),
  ),
  rule(
    String.raw`You can own at most (?<limit>\d+) team workspaces\. Delete one you no longer need or ask the platform administrator\.`,
    msg(
      'You can own at most {limit} team workspaces. Delete one you no longer need or ask the platform administrator.',
    ),
  ),

  // ---------------------------------------------------------- auth, session
  exact(msg('Not authenticated')),
  exact(msg('Session has been revoked')),
  exact(msg('Session is no longer valid')),
  exact(msg('Password change required before continuing')),
  exact(msg('Invalid username or password')),
  exact(msg('This account has been deactivated')),
  exact(msg('Too many attempts. Try again later.')),
  exact(msg('Current password is incorrect')),
  exact(msg('New password must differ from the current one')),
  exact(msg('Username or e-mail is already taken')),
  exact(msg('This link is invalid or has expired')),
  exact(msg('Account registration is closed. Ask the platform administrator for access.')),
  exact(msg('The setup token is not valid. Use the token printed at the end of install.sh.')),
  exact(msg('E-mail is already verified')),
  exact(msg('No e-mail address on file')),
  exact(msg('Password must be at least 12 characters')),
  exact(msg('Password must be at most 128 characters')),
  exact(msg('Valid e-mail required')),
  exact(msg('Username: letters, digits, dot, dash, underscore (2–39 chars)')),
  exact(msg('Sign out to end the current session')),

  // ---------------------------------------------------- projects, import
  rule(
    `This workspace already has a project named ${NAME}`,
    msg("This workspace already has a project named '{name}'"),
  ),
  exact(msg('Name: lowercase letters, digits and hyphens (2–41 chars), must start with a letter')),
  exact(msg('Slug: lowercase letters, digits and hyphens (2–40 chars); personal-* is reserved')),
  rule(
    String.raw`A repository named '(?<name>[^']+)' already exists in (?<provider>\w+)\. Choose a different project name, or import the existing repository\.`,
    msg(
      "A repository named '{name}' already exists in {provider}. Choose a different project name, or import the existing repository.",
    ),
  ),
  rule(
    `Repository ${NAME} is already connected to InitPad`,
    msg("Repository '{name}' is already connected to InitPad"),
  ),
  exact(
    msg('Repository name is not a valid project name (lowercase letters, digits and hyphens).'),
  ),
  exact(msg('Cannot import an empty repository — push code first.')),
  rule(
    String.raw`Cannot import '(?<name>[^']+)': no Dockerfile exists on '(?<branch>[^']+)' for the selected runtime\.`,
    msg("Cannot import '{name}': no Dockerfile exists on '{branch}' for the selected runtime."),
  ),
  rule(
    String.raw`Cannot import '(?<name>[^']+)': add the InitPad starter workflow at '(?<path>[^']+)' first\. You can download it from the import screen\.`,
    msg(
      "Cannot import '{name}': add the InitPad starter workflow at '{path}' first. You can download it from the import screen.",
    ),
  ),
  exact(msg('The Git service is temporarily unavailable. Try again in a few minutes.')),
  exact(msg('The pipeline preset changed concurrently; reload and retry')),
  exact(msg('The pipeline preset cannot change while a project operation is running')),
  exact(
    msg('Resolve or cancel the pending production request before changing the pipeline preset'),
  ),
  rule(
    String.raw`Environment '(?<env>[^']+)' is not empty\. Remove its deployment and finish any pending cleanup before changing the pipeline preset\.`,
    msg(
      "Environment '{env}' is not empty. Remove its deployment and finish any pending cleanup before changing the pipeline preset.",
    ),
  ),
  exact(msg('This provisioning operation is no longer retryable')),
  exact(msg('This provisioning operation has no pending cleanup')),
  exact(msg('This provisioning cleanup is already running')),
  exact(msg('Only a failed provisioning operation can be dismissed')),
  exact(msg('Retry requested')),
  exact(msg('Retry could not be started')),
  exact(msg('Provisioning cleanup is running')),
  exact(msg('Cleanup completed; this operation is safe to retry')),
  exact(msg('A newer attempt has been started')),
  exact(msg('The API process stopped before provisioning completed; reconciliation is required')),
  exact(msg('Project deletion requested')),

  // ------------------------------------------------- environments, deploys
  rule(
    String.raw`Environment ${ENV} is busy\. Cancel or wait for its current operation first\.`,
    msg("Environment '{env}' is busy. Cancel or wait for its current operation first."),
  ),
  rule(
    String.raw`Environment ${ENV} is busy\. Wait for or cancel its operation before changing config\.`,
    msg("Environment '{env}' is busy. Wait for or cancel its operation before changing config."),
  ),
  rule(`Environment ${ENV} is not stopped`, msg("Environment '{env}' is not stopped")),
  rule(`Environment ${ENV} is not running`, msg("Environment '{env}' is not running")),
  rule(`Environment ${ENV} has nothing to start`, msg("Environment '{env}' has nothing to start")),
  rule(
    `Environment ${ENV} has nothing to redeploy`,
    msg("Environment '{env}' has nothing to redeploy"),
  ),
  rule(
    `Environment ${ENV} (?:already )?has an active operation`,
    msg("Environment '{env}' has an active operation"),
  ),
  rule(
    String.raw`Environment ${ENV} still has pending cleanup\. Finish it before changing target\.`,
    msg("Environment '{env}' still has pending cleanup. Finish it before changing target."),
  ),
  rule(
    `Source environment ${ENV} has nothing to promote`,
    msg("Source environment '{env}' has nothing to promote"),
  ),
  rule(`Cannot promote to ${ENV}`, msg("Cannot promote to '{env}'")),
  exact(msg('Environment must be dev, test or prod')),
  exact(msg('Dev can only run again after it was cancelled or failed')),
  exact(msg('No verified default-branch CI build is available')),
  exact(msg('No repository commit is available to run')),
  exact(msg('Verified build artifact is no longer available')),
  exact(msg('Application config changed after this deployment was queued; start a new deployment')),
  exact(msg('Artifact ingestion was interrupted by a control-plane restart; run CI again')),
  rule(
    String.raw`CI failed before it could publish a deployable image \((?<jobs>[^)]*)\)\. Open the SCM run logs, fix the job and run again\.`,
    msg(
      'CI failed before it could publish a deployable image ({jobs}). Open the SCM run logs, fix the job and run again.',
    ),
  ),
  rule(
    String.raw`CI did not produce a deployable image \(CI result: (?<status>[^)]*)\)\. Open the SCM run logs, fix the failed job and run again\.`,
    msg(
      'CI did not produce a deployable image (CI result: {status}). Open the SCM run logs, fix the failed job and run again.',
    ),
  ),
  rule(String.raw`Cleanup pending: (?<detail>.+)`, msg('Cleanup pending: {detail}')),
  rule(String.raw`Cleanup failed: (?<detail>.+)`, msg('Cleanup failed: {detail}')),
  rule(
    String.raw`Could not remove (?<env>\w+) deployment from (?<target>.+?): (?<detail>.+)`,
    msg('Could not remove {env} deployment from {target}: {detail}'),
  ),
  rule(
    String.raw`(?<detail>.+); the operation in progress was cancelled`,
    msg('{detail}; the operation in progress was cancelled'),
  ),
  exact(msg('Cancellation requested — cleaning up')),
  exact(msg('Cancellation requested by user')),
  exact(msg('Cancelled because project deletion was requested')),
  exact(msg('Cancelled because another workflow step failed')),
  exact(msg('Target is no longer connected')),
  exact(msg('Environment operation failed')),
  exact(msg('Could not queue Agent operation')),
  exact(msg('Another operation is already active')),
  exact(msg('Gateway route could not be queued')),
  exact(msg('Agent delivery could not be prepared')),
  exact(msg('Approved production state changed before deployment started')),

  // ------------------------------------------------- production approvals
  exact(msg('Production deployments must be requested and approved')),
  exact(msg('Production redeployments must be requested and approved')),
  exact(msg('Production rollbacks must be requested and approved')),
  exact(msg('Production has an operation in progress')),
  exact(msg('This production request was reviewed concurrently')),
  exact(msg('This production request is no longer pending')),
  rule(
    String.raw`This production request is already (?<status>\w+)`,
    msg('This production request is already {status}'),
  ),
  exact(msg('This workspace requires a different person to approve production')),
  exact(msg('Another production request was created at the same time. Reload and review it.')),
  exact(msg('Artifact, target, or production configuration changed. Create a new request.')),
  exact(
    msg('Artifact, target, or production configuration changed. Create a new production request.'),
  ),
  exact(msg('The previous verified deployment changed. Review rollback again.')),
  exact(msg('The previous verified production deployment changed. Review rollback again.')),
  exact(msg('Production changed after rollback confirmation was opened. Review it again.')),

  // ------------------------------------------------ servers, workspace access
  rule(
    `(?:You|This workspace) already ha(?:ve|s) a target named ${NAME}`,
    msg("A server named '{name}' already exists"),
  ),
  exact(msg('This target host is reserved or unsafe')),
  exact(msg('Built-in targets cannot be modified')),
  exact(msg('Target type cannot be changed; create a new target instead')),
  exact(msg('Public URL must be a safe HTTP(S) address')),
  exact(msg('Hosted SFTP targets must resolve only to public internet addresses')),
  exact(msg('Hosted SFTP public URLs must resolve only to public internet addresses')),
  exact(msg('Could not retrieve the SSH host key from this server')),
  exact(msg('Host key fingerprint must use the OpenSSH SHA256:<base64> format')),
  exact(msg('Remote path must be an absolute path without spaces or parent traversal')),
  exact(msg('Managed gateway routing is available only for Docker Agent targets')),
  exact(
    msg(
      'Agent-backed Docker targets are verified by Agent heartbeat, not an inbound connection test',
    ),
  ),
  exact(msg('A target in use cannot remove runtime capabilities. Move its environments first.')),
  exact(msg('A target in use cannot change routing mode. Remove or move its environments first.')),
  rule(
    String.raw`Capabilities not offered by the target: (?<list>.+)`,
    msg('Capabilities not offered by the target: {list}'),
  ),
  rule(
    String.raw`This target is used by (?<count>\d+) environment\(s\)\. Point them at another target first\.`,
    msg('This target is used by {count} environment(s). Point them at another target first.'),
  ),
  rule(
    String.raw`This target has (?<count>\d+) deployment operation\(s\) in progress\. Wait for them before editing the target\.`,
    msg(
      'This target has {count} deployment operation(s) in progress. Wait for them before editing the target.',
    ),
  ),
  rule(
    String.raw`Release the deployments still recorded on this server first: (?<list>.+)\.`,
    msg('Release the deployments still recorded on this server first: {list}.'),
  ),
  exact(msg('Restore this retired target before editing it')),
  exact(msg('Restore this retired target before verifying its connection')),
  exact(msg('Restore this retired target before disconnecting it')),
  exact(msg('Restore this retired target before enrolling an Agent')),
  exact(msg('Only a retired target can be restored')),
  rule(
    String.raw`Target ${NAME} must pass Test connection before it can host an environment\.`,
    msg("Target '{name}' must pass Test connection before it can host an environment."),
  ),
  rule(
    String.raw`Target ${NAME} is (?<state>\w+); reconnect it before assigning an environment\.`,
    msg("Target '{name}' is {state}; reconnect it before assigning an environment."),
  ),
  rule(
    String.raw`Target ${NAME} cannot run (?<runtime>\w+) apps \(its capabilities: (?<capabilities>[^)]*)\)\.`,
    msg("Target '{name}' cannot run {runtime} apps (its capabilities: {capabilities})."),
  ),
  rule(
    String.raw`Remove the Agent-managed ${ENV} deployment before changing its target\.`,
    msg("Remove the Agent-managed '{env}' deployment before changing its target."),
  ),
  exact(msg('This workspace already has access to that server')),
  exact(msg('Workspace access to this server is paused; new deployments are disabled.')),
  rule(
    String.raw`Workspace access to ${NAME} is paused\.`,
    msg("Workspace access to '{name}' is paused."),
  ),
  rule(
    String.raw`Workspace access quota reached \(max (?<max>\d+) environments\)\.`,
    msg('Workspace access quota reached (max {max} environments).'),
  ),
  rule(
    String.raw`Workspace access is used by (?<count>\d+) environment\(s\)\. Move them first\.`,
    msg('Workspace access is used by {count} environment(s). Move them first.'),
  ),
  rule(
    String.raw`Workspace access has (?<count>\d+) deployment operation\(s\) in progress\. Wait for them before editing it\.`,
    msg(
      'Workspace access has {count} deployment operation(s) in progress. Wait for them before editing it.',
    ),
  ),

  // ------------------------------------------------------------ Agent
  exact(msg('Invalid Agent credential')),
  exact(msg('Invalid or expired Agent enrollment token')),
  exact(msg('Target is no longer available for Agent enrollment')),
  exact(msg('InitPad Agent can only be bound to a Docker target')),
  exact(msg('Enroll the target Agent before deploying to it')),
  exact(msg('Enroll the target Agent before requesting diagnostics')),
  rule(
    String.raw`Enroll and enable the Agent for target ${NAME} before using it\.`,
    msg("Enroll and enable the Agent for target '{name}' before using it."),
  ),
  exact(msg('No newer verified Agent release is available')),
  exact(msg('The verified Agent release is not currently available')),
  exact(msg('Restore the target before updating its Agent')),

  // ------------------------------------------------------ app variables
  exact(msg('Key must match ^[A-Z_][A-Z0-9_]* (uppercase letters, digits and underscore)')),
  rule(
    String.raw`'(?<key>[^']+)' is a reserved platform variable`,
    msg("'{key}' is a reserved platform variable"),
  ),
  rule(
    String.raw`Value must be a string up to (?<max>\d+) characters`,
    msg('Value must be a string up to {max} characters'),
  ),

  // ---------------------------- messages added by the API audit branches
  rule(
    String.raw`Environment ${ENV} has no server assigned \(its server was removed\)\. Choose a server for this environment before deploying\.`,
    msg(
      "Environment '{env}' has no server assigned (its server was removed). Choose a server for this environment before deploying.",
    ),
  ),
  exact(msg('This project is already being deleted. Wait for that deletion to finish.')),
  rule(
    String.raw`A deployment is still running in (?<names>.+)\. It has been cancelled; delete the project again once it has stopped\.`,
    msg(
      'A deployment is still running in {names}. It has been cancelled; delete the project again once it has stopped.',
    ),
  ),
  rule(
    String.raw`This server still hosts deployments: (?<names>.+)\. Remove them or move these environments to another server first\.`,
    msg(
      'This server still hosts deployments: {names}. Remove them or move these environments to another server first.',
    ),
  ),
  rule(
    String.raw`Repository ${NAME} is already being imported\. Wait for that import to finish\.`,
    msg("Repository '{name}' is already being imported. Wait for that import to finish."),
  ),
  rule(
    String.raw`Project ${NAME} is already being created\. Wait for that request to finish\.`,
    msg("Project '{name}' is already being created. Wait for that request to finish."),
  ),
  exact(msg('The selected verified deployment is no longer available. Review rollback again.')),
  exact(
    msg(
      'The selected verified production deployment is no longer available. Review rollback again.',
    ),
  ),
  rule(
    String.raw`Environment ${ENV} has nothing to redeploy\. Push a commit or run CI again\.`,
    msg("Environment '{env}' has nothing to redeploy. Push a commit or run CI again."),
  ),
  rule(
    String.raw`Repository activity is unavailable: (?<detail>.+)`,
    msg('Repository activity is unavailable: {detail}'),
  ),
  rule(String.raw`ci: queued (?<sha>[0-9a-f]+)`, msg('CI queued for {sha}')),
  exact(
    msg(
      'Only a workspace owner or admin can add a Docker Agent server, because only they can connect its Agent. A maintainer can add an SFTP server or use existing servers.',
    ),
  ),
  rule(
    String.raw`Agent offline since (?<since>\S+); start it or disconnect the server`,
    msg('Agent offline since {since}; start it or disconnect the server'),
  ),
  exact(msg('Agent has not connected yet; start it or disconnect the server')),
  rule(
    String.raw`Agent did not finish the job after (?<attempts>\d+) attempts; each lease expired without a result\. Check the Agent logs on the server, then retry\.`,
    msg(
      'Agent did not finish the job after {attempts} attempts; each lease expired without a result. Check the Agent logs on the server, then retry.',
    ),
  ),
  rule(
    String.raw`Candidate workload failed its health check: (?<detail>.+)`,
    msg('Candidate workload failed its health check: {detail}'),
  ),
  rule(
    String.raw`Workload failed its health check after start: (?<detail>.+)`,
    msg('Workload failed its health check after start: {detail}'),
  ),
  exact(msg('Candidate workload failed its health check')),

  // ------------------------------------------- deployment and job steps
  exact(msg('Waiting for Agent')),
  exact(msg('Claimed by Agent')),
  exact(msg('Waiting for an available CI runner')),
  exact(msg('CI runner started the build')),
  exact(msg('Waiting for GitHub Actions build')),
  rule(
    String.raw`Waiting for CI build; deployment target: (?<target>.+)`,
    msg('Waiting for CI build; deployment target: {target}'),
  ),
  rule(
    String.raw`Recovering tested GitHub build; deployment target: (?<target>.+)`,
    msg('Recovering tested GitHub build; deployment target: {target}'),
  ),
  exact(msg('Assigned to control plane')),
  exact(msg('Build artifact accepted')),
  exact(msg('Preparing deployment')),
  exact(msg('Downloading and verifying tested image')),
  exact(msg('Fetching & extracting tested artifact')),
  exact(msg('Connecting to target')),
  exact(msg('Checking target path')),
  exact(msg('Preparing container runtime')),
  exact(msg('Preparing release')),
  exact(msg('Resolving tested image')),
  exact(msg('Uploading archive')),
  exact(msg('Uploading files')),
  rule(
    String.raw`Uploading (?<done>\d+)/(?<total>\d+) files`,
    msg('Uploading {done}/{total} files'),
  ),
  exact(msg('Extracting on the server')),
  exact(msg('Replacing previous container')),
  exact(msg('Setting permissions')),
  exact(msg('Publishing release')),
  exact(msg('Publishing')),
  exact(msg('Starting container')),
  exact(msg('Verifying deployment')),
  exact(msg('Receiving verified image artifact')),
  exact(msg('Creating isolated candidate workload')),
  exact(msg('Verifying published workload health')),
  exact(msg('Publishing deployment result')),
  exact(msg('Inspecting allocation-scoped workload')),
  exact(msg('Recording bounded logs and health result')),
  exact(msg('Resolving wildcard gateway DNS')),
  exact(msg('Verifying trusted TLS on port 443')),
  exact(msg('Checking private Caddy adapter readiness')),
  exact(msg('Gateway DNS, TLS and adapter are ready')),
  exact(msg('Gateway DNS, TLS and Caddy adapter preflight passed')),
  exact(msg('Connecting gateway to the owned workload network')),
  exact(msg('Applying atomic Caddy route update')),
  exact(msg('Verifying the public HTTPS application path')),
  exact(msg('Retiring the superseded workload revision')),
  exact(msg('Waiting for Agent gateway reconcile')),
  exact(msg('Gateway route updated; waiting for Agent workload cleanup')),
  exact(msg('Verifying signed Agent release manifest')),
  exact(msg('Handing update to the local rollback supervisor')),
  rule(
    String.raw`Waiting to update Agent to (?<version>\S+)`,
    msg('Waiting to update Agent to {version}'),
  ),
];

// Nested messages are translated at most this deep; the API never nests more.
const MAX_DEPTH = 3;

function translate(message: string, depth: number): string {
  const trimmed = message.trim();
  for (const { pattern, key } of API_MESSAGE_RULES) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const vars: Record<string, string> = { ...match.groups };
    if (vars.detail !== undefined && depth < MAX_DEPTH) {
      vars.detail = translate(vars.detail, depth + 1);
    }
    return t(key, vars);
  }
  return message;
}

/** Translates a known API message (error, status reason or step); otherwise returns it unchanged. */
export function translateApiMessage(message: string): string;
export function translateApiMessage(message: string | null | undefined): string | null;
export function translateApiMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined || message === '') return message ?? null;
  return translate(message, 0);
}
