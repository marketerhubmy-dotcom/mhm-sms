#!/usr/bin/env node
// Jalankan Worker API (port 8787, D1 tempatan) dan frontend Vite (port 5173) serentak.
import { spawn } from 'node:child_process';
const procs = [
  spawn('npx', ['wrangler', 'dev', '-c', 'worker/wrangler.toml', '--port', '8787', '--ip', '127.0.0.1', '--test-scheduled'], { stdio: 'inherit' }),
  spawn('npx', ['vite', '--config', 'web/vite.config.ts'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
