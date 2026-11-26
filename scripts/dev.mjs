#!/usr/bin/env node
// Runs the API (node --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const children = [];

function run(name, command, args, colour) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\u001b[${colour}m[${name}]\u001b[0m `;
  const pipe = (stream, target) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (code !== 0) console.error(`${prefix}exited with code ${code}`);
  });
  children.push(child);
  return child;
}

run('api', process.execPath, ['--watch', 'server/index.js'], '36');
run('web', 'npx', ['vite', 'client'], '35');

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
