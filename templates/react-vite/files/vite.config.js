import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' → assets use relative paths, so the build also works when served
// under a subpath (https://host/<owner>-<project>-<env>/ via SFTP + nginx).
export default defineConfig({
  base: './',
  plugins: [react()],
});
