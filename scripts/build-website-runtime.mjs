import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The browser build is deliberately separate so deployments reuse its verified files.
await access(resolve(root, 'dist-website/index.html'));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['server/main.ts'],
  outfile: 'dist-server/main.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  minify: false,
  metafile: true,
  write: false,
  logLevel: 'warning',
});
const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
const unsupported = imports.filter(item => !item.external || !isBuiltin(item.path));
if (unsupported.length) {
  throw new Error(`Runtime still depends on non-builtin imports: ${unsupported.map(item => item.path).join(', ')}`);
}
for (const output of result.outputFiles) {
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, output.contents);
}
console.log(JSON.stringify({
  result: 'built',
  runtime: 'Node.js 24',
  entry: 'dist-server/main.mjs',
  bytes: result.outputFiles.reduce((total, output) => total + output.contents.byteLength, 0),
  externalImports: [...new Set(imports.map(item => item.path))].sort(),
  staticDirectory: 'dist-website',
  start: 'node dist-server/main.mjs',
}, null, 2));
