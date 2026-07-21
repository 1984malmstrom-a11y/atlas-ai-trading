import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nextConfig = require('eslint-config-next');

// `nextConfig` exports an array of configs; re-export them and add ignores
const eslintConfig = [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
];

export default eslintConfig;
