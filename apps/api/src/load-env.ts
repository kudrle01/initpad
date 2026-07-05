import { resolve } from 'path';

// Must be imported before anything else (in particular before config.ts) so
// that variables from .env are present in process.env by the time the config
// module reads them. The .env file is looked up next to the package first.
for (const path of [resolve(__dirname, '../.env'), resolve(process.cwd(), '.env')]) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    // Try the next candidate path; .env is optional (sane defaults exist).
  }
}
