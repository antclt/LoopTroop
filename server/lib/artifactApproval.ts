import { contentSha256 } from './contentHash'

export class StaleArtifactApprovalError extends Error {
  constructor(
    public readonly artifactType: string,
    public readonly expectedContentSha256: string,
    public readonly currentContentSha256: string,
  ) {
    super(`Stale ${artifactType} approval`)
  }
}

export function assertExpectedContentSha256(input: {
  artifactType: string
  currentContent: string
  expectedContentSha256: string
}): string {
  const currentContentSha256 = contentSha256(input.currentContent)
  if (input.expectedContentSha256 !== currentContentSha256) {
    throw new StaleArtifactApprovalError(
      input.artifactType,
      input.expectedContentSha256,
      currentContentSha256,
    )
  }
  return currentContentSha256
}
