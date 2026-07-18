import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchConnectedModelIds } from '../providerCatalog'
import { MAX_COUNCIL_MEMBERS, validateModelSelection } from '../modelValidation'

vi.mock('../providerCatalog', () => ({
  fetchConnectedModelIds: vi.fn(),
}))

const models = Array.from({ length: 7 }, (_, index) => `provider/model-${index + 1}`)

describe('validateModelSelection', () => {
  beforeEach(() => {
    vi.mocked(fetchConnectedModelIds).mockResolvedValue(models)
  })

  it('accepts a six-member council including the main implementer', async () => {
    const result = await validateModelSelection(models[0], JSON.stringify(models.slice(0, 6)))

    expect(result.councilMembers).toHaveLength(MAX_COUNCIL_MEMBERS)
  })

  it('rejects a council larger than six members', async () => {
    await expect(
      validateModelSelection(models[0], JSON.stringify(models)),
    ).rejects.toThrow('At most 6 distinct council members are allowed, including the main implementer.')
  })
})
