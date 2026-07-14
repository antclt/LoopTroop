import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocsOrigin, getDocsPort } from '../shared/appConfig'
import { resolveDevHostMode } from './dev-host-mode'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const binExtension = process.platform === 'win32' ? '.cmd' : ''
const vitepressBin = resolve(repoRoot, 'node_modules', '.bin', `vitepress${binExtension}`)
const docsPort = getDocsPort()
const docsOrigin = getDocsOrigin()
const devHostMode = (() => {
  try {
    return resolveDevHostMode()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[dev-docs] ${message}`)
    process.exit(1)
  }
})()
const vitepressArgs = ['dev', 'docs', '--port', String(docsPort), '--strictPort']

if (devHostMode.enabled) {
  vitepressArgs.push('--host', devHostMode.bindHost)
}

console.log(`[dev-docs] Starting VitePress docs at ${docsOrigin}/docs/.`)

const child = spawn(vitepressBin, vitepressArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(`[dev-docs] Failed to start VitePress: ${error.message}`)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal)
    }
  })
}

child.once('exit', (code) => {
  process.exit(code ?? 0)
})
