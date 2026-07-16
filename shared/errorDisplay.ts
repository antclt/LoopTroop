const DECORATION_ONLY_LINE = /^[\s\-_=~.*:|/\\()[\]{}<>+─-╿▀-▟■-◿➯⬀-⯿]+$/u
const ESCAPE = String.fromCodePoint(27)
const BELL = String.fromCodePoint(7)
const C1_CSI = String.fromCodePoint(155)
const C1_OSC = String.fromCodePoint(157)
const ANSI_OSC_SEQUENCE = new RegExp(`(?:${ESCAPE}\\]|${C1_OSC})[^${BELL}]*(?:${BELL}|${ESCAPE}\\\\)`, 'g')
const ANSI_CSI_SEQUENCE = new RegExp(`(?:${ESCAPE}\\[|${C1_CSI})[0-?]*[ -/]*[@-~]`, 'g')

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    if (character === '\n' || character === '\t') return character
    const code = character.codePointAt(0) ?? 0
    return code < 32 || (code >= 127 && code <= 159) ? '' : character
  }).join('')
}

function isDecorationOnly(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length >= 4 && DECORATION_ONLY_LINE.test(trimmed)
}

function dedupeConsecutiveSentences(line: string): string {
  const segments = line.split(/(?<=[.!?])\s+/)
  if (segments.length < 2) return line
  return segments.filter((segment, index) => {
    if (index === 0) return true
    const comparable = segment.trim().replace(/\s+/g, ' ').toLowerCase()
    const previous = segments[index - 1]?.trim().replace(/\s+/g, ' ').toLowerCase()
    return comparable.length === 0 || comparable !== previous
  }).join(' ')
}

/** Builds a readable view while leaving persisted errors and raw logs unchanged. */
export function sanitizeErrorForDisplay(value: string): string {
  const normalized = stripControlCharacters(
    value.replace(ANSI_OSC_SEQUENCE, '').replace(ANSI_CSI_SEQUENCE, '').replace(/\r\n?/g, '\n'),
  )
  const lines: string[] = []
  let previousComparable: string | null = null

  for (const rawLine of normalized.split('\n')) {
    const line = dedupeConsecutiveSentences(rawLine.trimEnd())
    if (isDecorationOnly(line)) continue
    const comparable = line.trim().replace(/\s+/g, ' ').toLowerCase()
    if (comparable && comparable === previousComparable) continue
    if (comparable) previousComparable = comparable
    lines.push(line)
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
