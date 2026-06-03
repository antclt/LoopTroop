import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const siteDir = path.join(root, 'site')
const docsDistDir = path.join(root, 'docs/.vitepress/dist')

await rm(siteDir, { recursive: true, force: true })
await mkdir(path.join(siteDir, 'docs'), { recursive: true })

await copyFile(path.join(root, 'web.html'), path.join(siteDir, 'index.html'))
await cp(path.join(root, 'public'), siteDir, { recursive: true })
await cp(docsDistDir, path.join(siteDir, 'docs'), { recursive: true })

// Preserve current web.html screenshot links until they are moved to /docs/assets/.
await cp(path.join(docsDistDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true })
