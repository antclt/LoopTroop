import { chmodSync, lstatSync, readdirSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Restores the owner permissions required to traverse and remove a tree.
 * Symlinks are deliberately left untouched so their targets are never changed.
 */
export function makeOwnerWritableRecursive(targetPath: string): void {
  let stats: Stats
  try {
    stats = lstatSync(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  if (stats.isSymbolicLink()) return

  if (stats.isDirectory()) {
    chmodSync(targetPath, stats.mode | 0o700)
    for (const entry of readdirSync(targetPath)) {
      makeOwnerWritableRecursive(resolve(targetPath, entry))
    }
    return
  }

  chmodSync(targetPath, stats.mode | 0o600)
}
