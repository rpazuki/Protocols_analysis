import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function pathsFor(basePath: string, values: string[]): string[] {
  const source = `import { appPath } from './apps/web/src/lib/paths.ts';
    console.log(JSON.stringify(${JSON.stringify(values)}.map(value => appPath(value))));`;
  return JSON.parse(execFileSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1', NEXT_PUBLIC_BASE_PATH: basePath },
    }));
}

describe('base-path helpers', () => {
  test('adds the deployment prefix exactly once, including queries and fragments', () => {
    assert.deepEqual(pathsFor('/protocols', [
      '/reports', '/protocols/reports', '/protocols', '/protocols?sort=date',
      '/protocols#main', '/protocols-other', '/',
    ]), [
      '/protocols/reports', '/protocols/reports', '/protocols', '/protocols?sort=date',
      '/protocols#main', '/protocols/protocols-other', '/protocols',
    ]);
  });
  test('also supports a different deployment prefix', () => {
    assert.deepEqual(pathsFor('/lab', ['/reports', '/lab/reports']), ['/lab/reports', '/lab/reports']);
  });
  test('does not add a prefix for a root deployment', () => {
    assert.deepEqual(pathsFor('/', ['/reports', '/']), ['/reports', '/']);
  });
});
