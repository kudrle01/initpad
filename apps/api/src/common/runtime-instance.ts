import { randomUUID } from 'node:crypto';

// Opaque and process-local. It correlates black-box replica acceptance with
// telemetry without exposing a hostname, pod name or cloud identifier.
export const runtimeInstanceId = randomUUID();
