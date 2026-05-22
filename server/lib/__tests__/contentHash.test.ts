import { describe, expect, it } from 'vitest'
import { contentSha256 } from '../contentHash'

describe('contentSha256', () => {
  it('returns the same hash for the same raw content', () => {
    const raw = 'artifact: prd\nstatus: draft\n'

    expect(contentSha256(raw)).toBe(contentSha256(raw))
  })

  it('returns different hashes when raw content changes', () => {
    expect(contentSha256('status: draft\n')).not.toBe(contentSha256('status: approved\n'))
  })

  it('hashes UTF-8 content consistently', () => {
    expect(contentSha256('Résumé approval ✓\n')).toBe('118ef6e29010460da79973b023e9fccea9f392eb9c415a32f50e22b39f47dca6')
  })
})
