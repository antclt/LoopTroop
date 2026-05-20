import type { ModelErrorInfo } from './errorDetails'
import { extractModelErrorInfo } from './errorDetails'
import type { Message, MessagePart, StepFinishMessagePart } from './types'

export interface OpenCodeResponseMeta {
  hasAssistantMessage: boolean
  latestAssistantMessageId?: string
  latestAssistantWasEmpty: boolean
  latestAssistantHasError: boolean
  latestAssistantError?: string
  latestAssistantErrorInfo?: ModelErrorInfo
  latestAssistantWasStale: boolean
  sessionErrored?: boolean
  sessionError?: string
  sessionErrorDetails?: unknown
  latestStepFinishReason?: string
  latestStepFinishTokens?: StepFinishMessagePart['tokens']
}

export interface AssistantMessageAnalysis {
  responseText: string
  responseMeta: OpenCodeResponseMeta
}

export function extractTextFromMessageParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part): part is { type?: string; text?: string } => Boolean(part && typeof part === 'object'))
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

function normalizeAssistantError(error: unknown): string | undefined {
  if (!error) return undefined
  if (error instanceof Error) {
    const message = error.message.trim()
    return message.length > 0 ? message : error.name
  }
  if (typeof error === 'string') {
    const message = error.trim()
    return message.length > 0 ? message : undefined
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function stringifyStructuredValue(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function findLatestStepFinish(parts: MessagePart[] | undefined): {
  reason?: string
  tokens?: StepFinishMessagePart['tokens']
} {
  if (!Array.isArray(parts)) return {}

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.type !== 'step-finish') continue
    const reason = typeof part.reason === 'string' && part.reason.trim().length > 0
      ? part.reason.trim()
      : undefined
    return {
      ...(reason ? { reason } : {}),
      ...(part.tokens ? { tokens: part.tokens } : {}),
    }
  }

  return {}
}

function analyzeSingleAssistantMessage(
  message: Message,
  options?: {
    stale?: boolean
  },
): AssistantMessageAnalysis {
  const stepFinish = findLatestStepFinish(message.parts as MessagePart[] | undefined)
  const latestAssistantError = normalizeAssistantError(message.info?.error)
  if (latestAssistantError) {
    return {
      responseText: '',
      responseMeta: {
        hasAssistantMessage: true,
        latestAssistantMessageId: message.id,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: true,
        latestAssistantError,
        latestAssistantErrorInfo: extractModelErrorInfo(message.info?.error),
        latestAssistantWasStale: Boolean(options?.stale),
        ...(stepFinish.reason ? { latestStepFinishReason: stepFinish.reason } : {}),
        ...(stepFinish.tokens ? { latestStepFinishTokens: stepFinish.tokens } : {}),
      },
    }
  }

  const partText = extractTextFromMessageParts(message.parts as MessagePart[] | undefined)
  const structuredText = message.info?.structured !== undefined
    ? stringifyStructuredValue(message.info.structured)
    : ''
  const text = (partText || message.content?.trim() || structuredText || '').trim()

  return {
    responseText: options?.stale ? '' : text,
    responseMeta: {
      hasAssistantMessage: true,
      latestAssistantMessageId: message.id,
      latestAssistantWasEmpty: text.length === 0 || Boolean(options?.stale),
      latestAssistantHasError: false,
      latestAssistantWasStale: Boolean(options?.stale),
      ...(stepFinish.reason ? { latestStepFinishReason: stepFinish.reason } : {}),
      ...(stepFinish.tokens ? { latestStepFinishTokens: stepFinish.tokens } : {}),
    },
  }
}

export function analyzeAssistantMessages(
  messages: Message[],
  preferredMessageId?: string,
): AssistantMessageAnalysis {
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  if (assistantMessages.length === 0) {
    return {
      responseText: '',
      responseMeta: {
        hasAssistantMessage: false,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
      },
    }
  }

  if (preferredMessageId) {
    const preferredMessage = assistantMessages.find((message) => message.id === preferredMessageId)
    if (preferredMessage) {
      return analyzeSingleAssistantMessage(preferredMessage)
    }
  }

  let latestAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      latestAssistantIndex = index
      break
    }
  }

  if (latestAssistantIndex < 0) {
    return {
      responseText: '',
      responseMeta: {
        hasAssistantMessage: false,
        latestAssistantWasEmpty: true,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
      },
    }
  }

  const latestAssistant = messages[latestAssistantIndex]!
  const newerConversationTurnExists = messages
    .slice(latestAssistantIndex + 1)
    .some((message) => message.role === 'user' || message.role === 'system')

  return analyzeSingleAssistantMessage(latestAssistant, {
    stale: newerConversationTurnExists,
  })
}
