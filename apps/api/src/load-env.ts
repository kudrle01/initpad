import { resolve } from 'path';

// Musí se importovat jako úplně první (před config.ts), aby proměnné z .env
// byly v process.env dřív, než je config přečte. .env hledáme vedle balíčku.
for (const path of [resolve(__dirname, '../.env'), resolve(process.cwd(), '.env')]) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    // zkusíme další cestu; .env je nepovinný (Gitea/Docker mají fallback)
  }
}
