import type { PromptSessionOptions } from './types'

export type OpenCodeToolPolicy = 'default' | 'disabled' | 'read_only' | 'execution_setup_online'

export const OPENCODE_DEFAULT_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({
  webfetch: false,
  websearch: false,
})

export const OPENCODE_DISABLED_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({
  '*': false,
  bash: false,
  codesearch: false,
  doom_loop: false,
  edit: false,
  external_directory: false,
  glob: false,
  grep: false,
  list: false,
  lsp: false,
  question: false,
  read: false,
  skill: false,
  task: false,
  todoread: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
  write: false,
})

export const OPENCODE_READ_ONLY_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({
  '*': false,
  bash: false,
  codesearch: true,
  doom_loop: false,
  edit: false,
  external_directory: false,
  glob: true,
  grep: true,
  list: true,
  lsp: true,
  question: false,
  read: true,
  skill: false,
  task: false,
  todoread: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
  write: false,
})

export const OPENCODE_EXECUTION_SETUP_ONLINE_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({
  webfetch: true,
  websearch: true,
})

export function resolveOpenCodeTools(
  toolPolicy: OpenCodeToolPolicy = 'default',
): PromptSessionOptions['tools'] | undefined {
  if (toolPolicy === 'default') return OPENCODE_DEFAULT_TOOLS
  if (toolPolicy === 'disabled') return OPENCODE_DISABLED_TOOLS
  if (toolPolicy === 'read_only') return OPENCODE_READ_ONLY_TOOLS
  if (toolPolicy === 'execution_setup_online') return OPENCODE_EXECUTION_SETUP_ONLINE_TOOLS
  return undefined
}
