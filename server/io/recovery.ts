import {
  readdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  openSync,
  readSync,
  ftruncateSync,
  closeSync,
} from 'fs'
import { join } from 'path'

/** Files below this threshold are loaded entirely into memory (safe for Node's string limit). */
const MAX_DIRECT_READ_BYTES = 256 * 1024 * 1024 // 256 MB
/** Chunk size used when scanning large files backwards. */
const SCAN_CHUNK_SIZE = 8 * 1024 // 8 KB
/** Maximum bytes to scan backwards when looking for the start of the last line. */
const MAX_LAST_LINE_SCAN = 4 * 1024 * 1024 // 4 MB

// Scan for orphan .tmp files and promote them
export function recoverOrphanTmpFiles(rootDir: string): string[] {
  const recovered: string[] = []

  function scanDir(dir: string) {
    if (!existsSync(dir)) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          scanDir(fullPath)
        } else if (entry.name.endsWith('.tmp')) {
          const targetPath = fullPath.slice(0, -4) // remove .tmp
          try {
            renameSync(fullPath, targetPath)
            recovered.push(targetPath)
          } catch (err) {
            console.error(`[recovery] Failed to promote ${fullPath}:`, err)
          }
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  scanDir(rootDir)
  return recovered
}

// Fix trailing-line corruption in JSONL files
export function fixTrailingLineCorruption(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  const { size: fileSize } = statSync(filePath)
  if (fileSize === 0) return false

  if (fileSize > MAX_DIRECT_READ_BYTES) {
    return fixCorruptionLarge(filePath, fileSize)
  }

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // Remove empty trailing lines
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop()
  }

  // Check last line is valid JSON
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1]
    if (lastLine) {
      try {
        JSON.parse(lastLine)
      } catch {
        // Last line is corrupt, remove it
        console.warn(`[recovery] Truncating corrupt last line in ${filePath}`)
        lines.pop()
        writeFileSync(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8')
        return true
      }
    }
  }

  return false
}

/**
 * Large-file variant: scans backward in byte chunks to find the last line without
 * loading the whole file into memory. Only truncates — never re-encodes — to avoid
 * UTF-8 boundary issues.
 */
function fixCorruptionLarge(filePath: string, fileSize: number): boolean {
  const fd = openSync(filePath, 'r+')
  try {
    const contentEnd = findContentEnd(fd, fileSize)
    if (contentEnd <= 0) return false

    const lineStart = findLineStart(fd, contentEnd)
    if (lineStart === null) {
      console.warn(
        `[recovery] Skipping large-file corruption check for ${filePath}: ` +
          `last line exceeds ${MAX_LAST_LINE_SCAN / 1024 / 1024} MB scan limit`,
      )
      return false
    }

    const lineLen = contentEnd - lineStart
    const lineBuf = Buffer.allocUnsafe(lineLen)
    const bytesRead = readSync(fd, lineBuf, 0, lineLen, lineStart)
    const lastLine = lineBuf.subarray(0, bytesRead).toString('utf-8')

    try {
      JSON.parse(lastLine)
      return false
    } catch {
      console.warn(`[recovery] Truncating corrupt last line in ${filePath} (large file)`)
      ftruncateSync(fd, lineStart)
      return true
    }
  } finally {
    closeSync(fd)
  }
}

/** Returns the byte offset one past the last non-newline byte, or 0 if the file is all newlines. */
function findContentEnd(fd: number, fileSize: number): number {
  let pos = fileSize
  while (pos > 0) {
    const readSize = Math.min(SCAN_CHUNK_SIZE, pos)
    pos -= readSize
    const buf = Buffer.allocUnsafe(readSize)
    const bytesRead = readSync(fd, buf, 0, readSize, pos)
    for (let i = bytesRead - 1; i >= 0; i--) {
      if (buf[i] !== 0x0a && buf[i] !== 0x0d) {
        return pos + i + 1
      }
    }
  }
  return 0
}

/**
 * Returns the byte offset of the first byte of the last line (the byte right after
 * its preceding newline), scanning backward from `contentEnd`.
 * Returns `null` if the last line is longer than MAX_LAST_LINE_SCAN (too big to validate safely).
 */
function findLineStart(fd: number, contentEnd: number): number | null {
  const scanStart = Math.max(0, contentEnd - MAX_LAST_LINE_SCAN)
  let pos = contentEnd
  while (pos > scanStart) {
    const readSize = Math.min(SCAN_CHUNK_SIZE, pos - scanStart)
    pos -= readSize
    const buf = Buffer.allocUnsafe(readSize)
    const bytesRead = readSync(fd, buf, 0, readSize, pos)
    for (let i = bytesRead - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) {
        return pos + i + 1
      }
    }
  }
  // Scanned all the way to the beginning of the file (or scan limit)
  if (scanStart === 0) return 0
  return null
}
