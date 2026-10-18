#!/usr/bin/env node
/** Owner-only local account provisioning. Passwords never appear in argv or output. */
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localAuthRepo, auditRepo, closePool, withTransaction } from '@protocols/db';
import { loadDotEnv } from '../db/env.ts';

loadDotEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));

function passwordPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Use an interactive terminal; passwords are not accepted as command arguments.');
  }
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    function onKey(text: string | undefined, key: { name?: string; ctrl?: boolean }) {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key.ctrl && !text.includes('\u001b')) value += text;
    }
    process.stdin.on('keypress', onKey);
  });
}

async function main() {
  const [command, email] = process.argv.slice(2);
  if (!['create', 'reset', 'disable'].includes(command ?? '') || !email) {
    throw new Error('Usage: npm run local-users -- <create|reset|disable> <email>');
  }
  let password = '';
  if (command !== 'disable') {
    password = await passwordPrompt('Password (12–1024 characters): ');
    if (password !== await passwordPrompt('Confirm password: ')) throw new Error('Passwords do not match.');
  }
  await withTransaction(async client => {
    if (command === 'disable') await localAuthRepo.disable(email, client);
    else await localAuthRepo.setPassword(email, password, command === 'create', client);
    await auditRepo.recordAuditEvent({ actorEmail: 'cli@localhost',
      action: command === 'create' ? 'local-account.create' : command === 'reset' ? 'local-account.reset' : 'local-account.disable',
      targetType: 'local_account', targetId: email.toLowerCase().trim(), metadata: { via: 'cli' } }, client);
  });
  console.log(`Local account ${command} completed. Admin rights are managed separately.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local account operation failed.');
  process.exitCode = 1;
}).finally(() => closePool());
