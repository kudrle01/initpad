/** @type {import('next').NextConfig} */
module.exports = {
  // Emits .next/standalone: a minimal server with only the files it imports,
  // so the runtime image needs no `npm ci` (237 MB instead of 541 MB).
  output: 'standalone',
};
