/** Reject obvious tool-presence/version checks as functional workspace readiness probes. */
export function isVersionOnlyWorkspaceProbeCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  // A compound command can include a version diagnostic and still perform a real project check.
  if (/&&|\|\||[;\n]/.test(trimmed)) return false
  const withoutRedirect = trimmed.replace(/\s+(?:\d?>|\d?>>|&>)\s*\S+\s*$/, '').trim()
  return /(?:^|\s)(?:--version|-version|-V|-v|version)\s*$/.test(withoutRedirect)
}
