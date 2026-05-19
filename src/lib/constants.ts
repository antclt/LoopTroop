/** Delay before hiding copy-success indicator */
export const COPY_SUCCESS_DISPLAY_MS = 2000
/** SSE reconnection delay */
export const SSE_RECONNECT_DELAY_MS = 3000
/** Interval for polling backend health to detect server downtime */
export const BACKEND_HEALTH_POLL_MS = 3000
/** Default API call timeout */
export const API_TIMEOUT_MS = 1000
/** Model fetch timeout */
export const MODEL_FETCH_TIMEOUT_MS = 5000
/** Max raw output length before truncation */
export const MAX_RAW_OUTPUT_LENGTH = 4000

/** Dropdown positioning */
export const DROPDOWN_MARGIN = 8
export const DROPDOWN_OFFSET = 4
export const DROPDOWN_MAX_HEIGHT = 420
export const DROPDOWN_PADDING = 12

/** Delay before focusing dropdown search input (lets DOM settle after portal mount) */
export const DROPDOWN_FOCUS_DELAY_MS = 50

/** Query stale time for infrequently-changing data (5 minutes) */
export const QUERY_STALE_TIME_5M = 5 * 60 * 1000
/** Default retry count for OpenCode API calls */
export const OPENCODE_RETRY_COUNT = 8
/** Default toast notification duration */
export const TOAST_DURATION_MS = 4000
/** Interval for polling to recover unanswered AI questions */
export const QUESTION_RECOVERY_INTERVAL_MS = 30_000
