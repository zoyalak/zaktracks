/** Bundles the API Worker with esbuild and writes the deploy manifest. */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(ROOT, 'build'), { recursive: true })

await build({
  entryPoints: [join(ROOT, 'worker', 'index.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser'],
  minify: true,
  outfile: join(ROOT, 'build', 'worker.js'),
  logLevel: 'info',
})

const manifest = {
  entrypoint: 'index.js',
  compatibilityDate: '2026-10-01',
  modules: [{ name: 'index.js', type: 'esm', path: './build/worker.js' }],
  assetsDirectory: './dist',
  spa: true,
}

writeFileSync(join(ROOT, 'freebuff.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log('wrote build/worker.js and freebuff.manifest.json')
