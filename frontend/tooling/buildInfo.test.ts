import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { buildInfoPlugin, fingerprintArtifacts, readSourceIdentity } from './buildInfo';

const temporaryRoots: string[] = [];
function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'velocitydb-build-info-'));
  temporaryRoots.push(root);
  return root;
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function repository() {
  const root = temporaryRoot();
  git(root, 'init');
  git(root, 'config', 'user.name', 'Build Identity Test');
  git(root, 'config', 'user.email', 'build-test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(root, 'tracked.txt'), 'original');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-m', 'test fixture');
  return root;
}

function asset(fileName: string, source: string | Uint8Array) {
  return { type: 'asset' as const, fileName, source };
}

function chunk(fileName: string, code: string) {
  return { type: 'chunk' as const, fileName, code };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('frontend source identity', () => {
  it('reports unknown outside Git and before the first commit', () => {
    const root = temporaryRoot();
    expect(readSourceIdentity(root)).toBe('unknown');
    git(root, 'init');
    expect(readSourceIdentity(root)).toBe('unknown');
  });

  it('uses the short commit and ignores untracked outputs', () => {
    const root = repository();
    const source = git(root, 'rev-parse', '--short=12', 'HEAD');
    expect(readSourceIdentity(root)).toBe(source);
    writeFileSync(path.join(root, 'build-output.txt'), 'untracked');
    expect(readSourceIdentity(root)).toBe(source);
  });

  it('marks both unstaged and staged tracked changes dirty', () => {
    const root = repository();
    const source = git(root, 'rev-parse', '--short=12', 'HEAD');
    writeFileSync(path.join(root, 'tracked.txt'), 'changed');
    expect(readSourceIdentity(root)).toBe(`${source}-dirty`);
    git(root, 'add', 'tracked.txt');
    expect(readSourceIdentity(root)).toBe(`${source}-dirty`);
  });
});

describe('frontend artifact fingerprint', () => {
  it('is deterministic regardless of output order and text/binary representation', () => {
    const html = asset('index.html', '<script src="assets/main.js"></script>');
    const js = chunk('assets/main.js', 'start();');
    const fingerprint = fingerprintArtifacts([html, js]);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintArtifacts([js, html])).toBe(fingerprint);
    expect(
      fingerprintArtifacts([
        js,
        asset(html.fileName, Buffer.from('<script src="assets/main.js"></script>')),
      ])
    ).toBe(fingerprint);
  });

  it('changes when runtime content or a filename changes', () => {
    const baseline = fingerprintArtifacts([chunk('assets/main.js', 'start();')]);
    expect(fingerprintArtifacts([chunk('assets/main.js', 'changed();')])).not.toBe(baseline);
    expect(fingerprintArtifacts([chunk('assets/renamed.js', 'start();')])).not.toBe(baseline);
    expect(
      fingerprintArtifacts([
        chunk('assets/main.js', 'start();'),
        asset('assets/main.css', 'body{}'),
      ])
    ).not.toBe(baseline);
  });

  it('excludes source maps, reports, and generated metadata', () => {
    const runtime = [asset('index.html', 'app'), chunk('assets/main.js', 'start();')];
    const metadata = [
      'assets/main.js.map',
      'assets/main.css.map',
      'bundle-report.html',
      'build-info.json',
      '.vite/manifest.json',
      '.vite/ssr-manifest.json',
    ].map((fileName) => asset(fileName, 'non-runtime data'));
    expect(fingerprintArtifacts([...runtime, ...metadata])).toBe(fingerprintArtifacts(runtime));
  });
});

describe('buildInfoPlugin', () => {
  it('embeds and emits the same source with the final runtime fingerprint for a build', () => {
    const root = repository();
    const plugin = buildInfoPlugin(root);
    const source = readSourceIdentity(root);
    const config = Reflect.apply(plugin.config, {}, [{}, { command: 'build', mode: 'production' }]);
    expect(config.define.__VELOCITYDB_FRONTEND_SOURCE__).toBe(JSON.stringify(source));
    const bundle = { 'index.html': asset('index.html', 'app') };
    const fingerprint = fingerprintArtifacts(Object.values(bundle));
    const emitFile = vi.fn();
    Reflect.apply(plugin.generateBundle.handler, { emitFile }, [{}, bundle, false]);
    expect(emitFile).toHaveBeenCalledExactlyOnceWith({
      type: 'asset',
      fileName: 'build-info.json',
      source: `${JSON.stringify({ source, fingerprint })}\n`,
    });
  });

  it('still emits unknown-source metadata from a source archive', () => {
    const plugin = buildInfoPlugin(temporaryRoot());
    const config = Reflect.apply(plugin.config, {}, [{}, { command: 'build', mode: 'production' }]);
    expect(config.define.__VELOCITYDB_FRONTEND_SOURCE__).toBe('"unknown"');
    const emitFile = vi.fn();
    Reflect.apply(plugin.generateBundle.handler, { emitFile }, [{}, {}, false]);
    expect(JSON.parse(emitFile.mock.calls[0]?.[0].source)).toEqual({
      source: 'unknown',
      fingerprint: fingerprintArtifacts([]),
    });
  });

  it('defines development source but never emits an artifact manifest for serve', () => {
    const plugin = buildInfoPlugin(temporaryRoot());
    const config = Reflect.apply(plugin.config, {}, [
      {},
      { command: 'serve', mode: 'development' },
    ]);
    expect(config.define.__VELOCITYDB_FRONTEND_SOURCE__).toBe('"unknown"');
    const emitFile = vi.fn();
    Reflect.apply(plugin.generateBundle.handler, { emitFile }, [{}, {}, false]);
    expect(emitFile).not.toHaveBeenCalled();
  });
});
