import { describe, expect, it } from 'vitest'
import { OpenCodeSDKAdapter } from '../adapter'
import type { PromptPart } from '../types'

interface AdapterPartitionProbe {
  partitionPromptParts(parts: PromptPart[], fallbackSystem?: string, includeImageFiles?: boolean): {
    systemText: string
    promptParts: Array<{ type: string; text?: string; mime?: string; filename?: string; url?: string }>
  }
}

function probe(adapter: OpenCodeSDKAdapter): AdapterPartitionProbe {
  return adapter as unknown as AdapterPartitionProbe
}

describe('OpenCode Manual QA file parts', () => {
  it('forwards every snapshotted image file part without an additional count cap', () => {
    const adapter = new OpenCodeSDKAdapter('http://127.0.0.1:9')
    const images: PromptPart[] = Array.from({ length: 40 }, (_, index) => ({
      type: 'file',
      content: '',
      source: `manual_qa_evidence:item:${index}`,
      mime: index % 2 === 0 ? 'image/png' : 'image/svg+xml',
      filename: `image-${index}.png`,
      url: `file:///contained/image-${index}.png`,
    }))
    const result = probe(adapter).partitionPromptParts([
      { type: 'system', content: 'system' },
      { type: 'text', content: 'Manual QA evidence references' },
      ...images,
      { type: 'file', content: '', mime: 'application/pdf', filename: 'report.pdf', url: 'file:///contained/report.pdf' },
    ], undefined, true)

    expect(result.systemText).toBe('system')
    expect(result.promptParts.filter((part) => part.type === 'file')).toHaveLength(40)
    expect(result.promptParts.some((part) => part.filename === 'report.pdf')).toBe(false)
  })

  it('keeps references-only prompts text-only', () => {
    const adapter = new OpenCodeSDKAdapter('http://127.0.0.1:9')
    const result = probe(adapter).partitionPromptParts([
      { type: 'text', content: 'Evidence: screen.png (references only)' },
      { type: 'file', content: '', mime: 'image/png', filename: 'screen.png', url: 'file:///contained/screen.png' },
    ], undefined, false)
    expect(result.promptParts).toEqual([{ type: 'text', text: 'Evidence: screen.png (references only)' }])
  })
})
