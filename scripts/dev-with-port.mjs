import { spawn } from 'node:child_process';

spawn('npx', ['vite', '--host', '127.0.0.1'], { stdio: 'inherit', shell: process.platform === 'win32' });
