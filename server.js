// Production entry point for Plesk Node.js
// Registers tsx so TypeScript server files can be loaded directly
require('tsx/cjs');
require('./server/index.ts');
