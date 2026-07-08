import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base './' → relative asset paths, so the build also works under a subpath
// (https://host/<owner>-<project>-<env>/ via SFTP + nginx).
export default defineConfig({
  base: './',
  plugins: [vue()],
});
