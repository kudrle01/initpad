import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ENDPOINT = 'initpad.publicEndpoint';

export type PublicEndpointReason =
  | 'agent-credential'
  | 'authentication'
  | 'ci-token'
  | 'health-check'
  | 'oidc-protocol'
  | 'public-catalog'
  | 'scm-signature';

// The API is session-authenticated by default. This decorator is therefore a
// security boundary, not a convenience: every use must name the alternative
// protocol that protects the endpoint (or state that the data is public).
export const PublicEndpoint = (reason: PublicEndpointReason) =>
  SetMetadata(PUBLIC_ENDPOINT, reason);
