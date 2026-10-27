import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const updater = path.resolve('scripts/deploy/update.sh');

function deploy(mode: string, failure = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'protocols-deploy-'));
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'commands.jsonl');
  mkdirSync(bin);
  mkdirSync(path.join(repo, 'db/migrations'), { recursive: true });
  mkdirSync(path.join(repo, '.git'));
  writeFileSync(path.join(repo, 'package.json'), '{}');
  const owner = path.join(dir, 'owner.env');
  const app = path.join(dir, 'app.env');
  writeFileSync(owner, 'DATABASE_URL=must-not-appear-in-command-log\n');
  writeFileSync(app, '');
  const mock = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const command = path.basename(process.argv[1]);
let args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify([command, ...args])+'\\n');
if(command === 'sudo') {
  args = args.slice(3);
  const result = require('child_process').spawnSync(args[0], args.slice(1), {stdio:'inherit', env:process.env});
  process.exit(result.status ?? 1);
}
if(command === 'git') {
  if(args[0] === 'pull' && process.env.DEPLOY_TEST_FAILURE === 'pull') process.exit(1);
  if(args.includes('--absolute-git-dir')) console.log(path.join(process.cwd(), '.git'));
  else if(args[0] === 'status' && process.env.DEPLOY_TEST_FAILURE === 'dirty') console.log(' M source.ts');
  else if(args[0] === 'rev-parse') console.log('abcdef123456789');
}
if(command === 'flock' && process.env.DEPLOY_TEST_FAILURE === 'lock') process.exit(1);
if(command === 'systemd-run' && process.env.DEPLOY_TEST_FAILURE === 'migration') process.exit(1);
if(command === 'npm' && args.includes('build')) {
  if(process.env.DEPLOY_TEST_FAILURE === 'build') process.exit(1);
  fs.mkdirSync('apps/web/.next/static/chunks', {recursive:true});
  fs.mkdirSync('apps/web/.next/standalone/apps/web', {recursive:true});
  fs.writeFileSync('apps/web/.next/static/chunks/app.css', 'body {}');
  fs.writeFileSync('apps/web/.next/standalone/apps/web/server.js', '');
}
if(command === 'docker' && args.includes('ps')) {
  if(process.env.DEPLOY_TEST_FAILURE !== 'no-db') console.log('db-container-id');
}
if(command === 'curl') console.log('{"status":"ok"}');
`;
  for (const name of ['sudo', 'git', 'flock', 'systemctl', 'systemd-run', 'node', 'npm', 'docker', 'curl']) {
    writeFileSync(path.join(bin, name), mock, { mode: 0o755 });
  }
  // Source the actual script and replace only its privilege precondition so the
  // command-order/failure tests run without root on developer machines and CI.
  const result = spawnSync('bash', ['-c', 'source "$1"; require_root() { :; }; main "${@:2}"',
    'test', updater, '--repo', repo, '--mode', mode, '--owner-env', owner, '--app-env', app], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_TEST_LOG: log, DEPLOY_TEST_FAILURE: failure },
    encoding: 'utf8',
  });
  const commands = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
  const cssCopied = (() => { try { return readFileSync(path.join(repo, 'apps/web/.next/standalone/apps/web/.next/static/chunks/app.css'), 'utf8') === 'body {}'; } catch { return false; } })();
  rmSync(dir, { recursive: true, force: true });
  return { result, commands, cssCopied };
}

const has = (commands: string[][], ...prefix: string[]) => commands.some((command) => prefix.every((value, index) => command[index] === value));

test('native update applies migrations, packages CSS without public/, starts only after build, and checks health', () => {
  const { result, commands, cssCopied } = deploy('native');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(cssCopied, true);
  assert.ok(has(commands, 'git', 'pull', '--ff-only'));
  const index = (name: string, arg: string) => commands.findIndex((c) => c[0] === name && c.includes(arg));
  assert.ok(index('systemctl', 'stop') < index('npm', 'ci'));
  assert.ok(index('npm', 'ci') < index('systemd-run', 'scripts/db/migrate.ts'));
  assert.ok(index('systemd-run', 'scripts/db/migrate.ts') < index('npm', 'build'));
  assert.ok(index('npm', 'build') < index('systemctl', 'start'));
  assert.ok(has(commands, 'curl'));
  assert.ok(!JSON.stringify(commands).includes('must-not-appear'));
});

for (const failure of ['migration', 'build']) {
  test(`native ${failure} failure does not start an incomplete deployment`, () => {
    const { result, commands } = deploy('native', failure);
    assert.notEqual(result.status, 0);
    assert.equal(has(commands, 'systemctl', 'start'), false);
    assert.equal(has(commands, 'curl'), false);
  });
}

for (const failure of ['dirty', 'lock']) {
  test(`${failure} checkout is rejected before pull or service changes`, () => {
    const { result, commands } = deploy('native', failure);
    assert.notEqual(result.status, 0);
    assert.equal(has(commands, 'git', 'pull'), false);
    assert.equal(has(commands, 'systemctl', 'stop'), false);
  });
}

test('Docker updates only app, uses owner environment for migration and never recreates db', () => {
  const { result, commands } = deploy('docker');
  assert.equal(result.status, 0, result.stderr);
  const docker = commands.filter((c) => c[0] === 'docker');
  assert.ok(docker.some((c) => c.slice(-2).join(' ') === 'build app'));
  assert.ok(docker.some((c) => c.slice(-4).join(' ') === 'up -d --no-deps app'));
  assert.ok(!docker.some((c) => c.includes('pull') || (c.includes('up') && c.includes('db'))));
  const migrate = commands.find((c) => c[0] === 'systemd-run');
  assert.ok(migrate?.includes('DATABASE_URL'));
  assert.ok(migrate?.includes('--no-deps'));
  assert.ok(migrate?.includes('scripts/db/migrate.ts'));
});

test('Docker refuses an absent database before changing Git or containers', () => {
  const { result, commands } = deploy('docker', 'no-db');
  assert.notEqual(result.status, 0);
  assert.equal(has(commands, 'git', 'pull'), false);
  assert.ok(!commands.some((c) => c[0] === 'docker' && c.includes('build')));
});

test('a refused Git pull does not stop the running native service', () => {
  const { result, commands } = deploy('native', 'pull');
  assert.notEqual(result.status, 0);
  assert.equal(has(commands, 'systemctl', 'stop'), false);
  assert.equal(has(commands, 'npm', 'ci'), false);
});

test('Docker migration failure never starts the new image', () => {
  const { result, commands } = deploy('docker', 'migration');
  assert.notEqual(result.status, 0);
  assert.ok(commands.some((c) => c[0] === 'docker' && c.includes('stop')));
  assert.ok(!commands.some((c) => c[0] === 'docker' && c.includes('up')));
});
