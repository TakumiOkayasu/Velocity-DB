import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite-plus';

type Artifact = { fileName: string } & (
  | { type: 'chunk'; code: string }
  | { type: 'asset'; source: string | Uint8Array }
);

export function readSourceIdentity(root: string): string {
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const source = git(['rev-parse', '--short=12', 'HEAD']);
    if (!/^[0-9a-f]{12,40}$/.test(source)) return 'unknown';
    const dirty = git(['status', '--porcelain=v1', '--untracked-files=no']);
    return `${source}${dirty ? '-dirty' : ''}`;
  } catch {
    // Source archives and machines without Git can still produce identifiable artifacts.
    return 'unknown';
  }
}

export function fingerprintArtifacts(artifacts: readonly Artifact[]): string {
  const excluded = new Set([
    'build-info.json',
    'bundle-report.html',
    '.vite/manifest.json',
    '.vite/ssr-manifest.json',
  ]);
  const runtime = [...artifacts]
    .filter(({ fileName }) => !fileName.endsWith('.map') && !excluded.has(fileName))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  const hash = createHash('sha256');
  for (const artifact of runtime) {
    const content = artifact.type === 'chunk' ? artifact.code : artifact.source;
    // Frame each name and byte count so different file boundaries cannot hash identically.
    hash.update(`${artifact.fileName}\0${Buffer.byteLength(content)}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

export function buildInfoPlugin(root: string) {
  let source = 'unknown';
  let building = false;
  return {
    name: 'velocitydb-build-info',
    enforce: 'post',
    config(_config, env) {
      source = readSourceIdentity(root);
      building = env.command === 'build';
      return { define: { __VELOCITYDB_FRONTEND_SOURCE__: JSON.stringify(source) } };
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!building) return;
        const fingerprint = fingerprintArtifacts(Object.values(bundle));
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: `${JSON.stringify({ source, fingerprint })}\n`,
        });
      },
    },
  } satisfies Plugin;
}
