import { setMaxListeners } from 'node:events'

const OPENCODE_EVENT_LISTENER_WARNING_LIMIT = 20

function applyOpenCodeListenerLimit() {
  setMaxListeners(OPENCODE_EVENT_LISTENER_WARNING_LIMIT)
}

applyOpenCodeListenerLimit()

export const LoopTroopListenerLimit = async () => {
  applyOpenCodeListenerLimit()
  return {}
}
