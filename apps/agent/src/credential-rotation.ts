import type { AgentConfig, HeartbeatResponse } from './types.js';

const CREDENTIAL_PATTERN = /^initpad_agent_[A-Za-z0-9_-]{43}$/;

type PersistConfig = (config: AgentConfig) => Promise<void>;
type ConfirmCredential = (config: AgentConfig) => Promise<HeartbeatResponse>;

function replaceConfig(current: AgentConfig, next: AgentConfig): void {
  Object.assign(current, next);
  if (next.previousCredential === undefined) delete current.previousCredential;
  if (next.previousCredentialGeneration === undefined) {
    delete current.previousCredentialGeneration;
  }
}

function assertHeartbeatIdentity(config: AgentConfig, response: HeartbeatResponse): void {
  if (response.targetId !== config.targetId) {
    throw new Error('Control plane returned a different target identity');
  }
  if (response.credentialGeneration !== config.credentialGeneration) {
    throw new Error('Control plane returned a different credential generation');
  }
}

/**
 * Persists a pending credential before using it and retains the old value until
 * the control plane confirms the new generation. Either side can lose a
 * response without leaving the Agent with no usable identity.
 */
export async function reconcileCredentialRotation(
  config: AgentConfig,
  response: HeartbeatResponse,
  persist: PersistConfig,
  confirm: ConfirmCredential,
): Promise<HeartbeatResponse> {
  assertHeartbeatIdentity(config, response);
  const rotation = response.credentialRotation;
  if (rotation) {
    if (
      !CREDENTIAL_PATTERN.test(rotation.credential) ||
      rotation.credentialGeneration !== config.credentialGeneration + 1
    ) {
      throw new Error('Control plane returned an invalid credential rotation');
    }
    const pending: AgentConfig = {
      ...config,
      previousCredential: config.credential,
      previousCredentialGeneration: config.credentialGeneration,
      credential: rotation.credential,
      credentialGeneration: rotation.credentialGeneration,
    };
    await persist(pending);
    replaceConfig(config, pending);

    const confirmation = await confirm(config);
    assertHeartbeatIdentity(config, confirmation);
    if (!confirmation.credentialConfirmed) {
      throw new Error('Control plane did not confirm the rotated Agent credential');
    }
    const stable = { ...config };
    delete stable.previousCredential;
    delete stable.previousCredentialGeneration;
    await persist(stable);
    replaceConfig(config, stable);
    return confirmation;
  }

  if (response.credentialConfirmed && config.previousCredential) {
    const stable = { ...config };
    delete stable.previousCredential;
    delete stable.previousCredentialGeneration;
    await persist(stable);
    replaceConfig(config, stable);
  }
  return response;
}
