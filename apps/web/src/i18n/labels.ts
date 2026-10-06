import { getLocale } from '@/i18n';

/**
 * The API reports states, roles and operation kinds as lowercase tokens
 * ("running", "maintainer", "rollback"). English shows the token as it is;
 * Czech looks it up here and falls back to the token for anything unknown.
 */
const STATUS_CS: Record<string, string> = {
  running: 'běží',
  deploying: 'nasazuje se',
  failed: 'selhalo',
  stopped: 'zastaveno',
  empty: 'prázdné',
  idle: 'nečinné',
  pending: 'čeká',
  queued: 've frontě',
  leased: 'zpracovává se',
  waiting: 'čeká',
  succeeded: 'úspěch',
  success: 'úspěch',
  cancelled: 'zrušeno',
  accepted: 'přijato',
  online: 'online',
  offline: 'offline',
  disabled: 'vypnuto',
  'not-enrolled': 'nezaregistrován',
  active: 'aktivní',
  disconnected: 'odpojeno',
  retired: 'vyřazeno',
  approving: 'schvaluje se',
  approved: 'schváleno',
  rejected: 'zamítnuto',
  stale: 'zastaralé',
  interrupted: 'přerušeno',
  retrying: 'opakuje se',
  retried: 'zopakováno',
  cleaning: 'uklízí se',
  healthy: 'v pořádku',
  attention: 'vyžaduje pozornost',
  requesting: 'odesílá se',
  'rolled-back': 'vráceno zpět',
  passed: 'prošlo',
  'not-run': 'nespuštěno',
  // deployment phases
  assigned: 'přiděleno',
  verifying: 'ověřuje se',
  unhealthy: 'nezdravé',
};

const ROLE_CS: Record<string, string> = {
  owner: 'vlastník',
  admin: 'administrátor',
  maintainer: 'správce',
  member: 'člen',
  viewer: 'čtenář',
};

const OPERATION_CS: Record<string, string> = {
  deploy: 'nasazení',
  redeploy: 'opětovné nasazení',
  promote: 'povýšení',
  rollback: 'rollback',
  stop: 'zastavení',
  start: 'spuštění',
  teardown: 'odstranění',
  create: 'vytvoření',
  import: 'import',
  probe: 'test protokolu',
  'lifecycle-test': 'test životního cyklu',
  'gateway-preflight': 'kontrola brány',
  update: 'aktualizace',
  personal: 'osobní',
  team: 'týmový',
  user: 'uživatel',
  organization: 'organizace',
  all: 'všechny',
  selected: 'vybrané',
  // audit resources and provisioning effects
  workspace: 'workspace',
  member: 'člen',
  project: 'projekt',
  target: 'server',
  allocation: 'přidělení',
  agent: 'Agent',
  deployment: 'nasazení',
  provisioning: 'zakládání',
  'agent-job': 'úloha Agenta',
  repository: 'repozitář',
  secrets: 'tajemství',
};

function lookup(table: Record<string, string>, token: string): string {
  return getLocale() === 'cs' ? (table[token] ?? token) : token;
}

export const statusLabel = (status: string): string => lookup(STATUS_CS, status);
export const roleLabel = (role: string): string => lookup(ROLE_CS, role);
/** Operation kinds and other short API vocabulary (workspace type, account type). */
export const termLabel = (term: string): string => lookup(OPERATION_CS, term);
