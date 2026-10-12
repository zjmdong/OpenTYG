#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const app = await createApp({
  port: Number(flag('port', process.env.PORT || 8787)),
  host: String(flag('host', process.env.HOST || '0.0.0.0')),
  dataDir: String(flag('data', process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)))),
  origin: String(flag('origin', process.env.TYG_ORIGIN || '')),
});
process.stdout.write(`OpenTYG ready: ${app.url}\n`);

let shuttingDown = false;
const shutdown = async signal => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`Received ${signal}; shutting down.\n`);
  try { await app.close(); process.exitCode = 0; }
  catch { process.exitCode = 1; }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', error => {
  app.logger.error('Unhandled rejection', { code: /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'UNEXPECTED' });
});
