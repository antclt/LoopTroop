import { writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync, unlinkSync } from 'fs'
import { dirname } from 'path'

export function safeAtomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`
  const dir = dirname(filePath)

  mkdirSync(dir, { recursive: true })

  let tmpCreated = false
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    tmpCreated = true

    const fd = openSync(tmpPath, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    renameSync(tmpPath, filePath)
    tmpCreated = false

    // Best-effort parent-directory fsync for crash durability on Linux/macOS.
    // Not all platforms support opening directories; failures are silently ignored.
    try {
      const dirFd = openSync(dir, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    } catch {
      // Ignored — not critical and not supported on all filesystems
    }
  } finally {
    if (tmpCreated) {
      try { unlinkSync(tmpPath) } catch { /* best-effort cleanup */ }
    }
  }
}
