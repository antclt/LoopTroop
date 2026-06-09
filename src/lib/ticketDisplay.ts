export function getTicketExternalIdLabel(
  externalId: string,
  isDisplayOnlyMock?: boolean | null,
): string {
  return isDisplayOnlyMock ? `${externalId} mock demo ticket` : externalId
}
