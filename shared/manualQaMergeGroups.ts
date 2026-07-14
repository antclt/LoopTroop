export interface ManualQaMergeSelection {
  itemId: string
  status: string
  mergeWithItemIds?: string[]
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildManualQaMergeGroupIds(results: ManualQaMergeSelection[]): Map<string, string> {
  const failedIds = new Set(results.filter((result) => result.status === 'fail').map((result) => result.itemId))
  const parent = new Map([...failedIds].map((itemId) => [itemId, itemId]))
  const find = (itemId: string): string => {
    const current = parent.get(itemId) ?? itemId
    if (current === itemId) return current
    const root = find(current)
    parent.set(itemId, root)
    return root
  }
  const union = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return
    const roots = [leftRoot, rightRoot].sort()
    parent.set(roots[1]!, roots[0]!)
  }
  for (const result of results) {
    if (!failedIds.has(result.itemId)) continue
    for (const selectedId of result.mergeWithItemIds ?? []) {
      if (failedIds.has(selectedId) && selectedId !== result.itemId) union(result.itemId, selectedId)
    }
  }
  const components = new Map<string, string[]>()
  for (const itemId of failedIds) {
    const root = find(itemId)
    components.set(root, [...(components.get(root) ?? []), itemId])
  }
  const groupIds = new Map<string, string>()
  for (const members of components.values()) {
    if (members.length < 2) continue
    const signature = members.sort().join('\u0000')
    const groupId = `qa-merge-${stableHash(signature)}`
    for (const itemId of members) groupIds.set(itemId, groupId)
  }
  return groupIds
}
