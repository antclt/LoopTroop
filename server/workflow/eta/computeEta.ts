/**
 * Deterministic ETA forecasting for bead execution.
 *
 * Produces a best/likely/worst time-remaining range from throughput samples. The math is pure and
 * side-effect free so it can be unit tested in isolation; all persistence lives in
 * `server/storage/executionTelemetry.ts`.
 *
 * Design notes:
 * - Throughput is measured as completed-bead duration with non-CODING waits already excluded by the
 *   telemetry recorder, so historical medians include normal local finalization and retry cost.
 * - The retry-pressure multiplier is a ratio normalised to the historical baseline, so it only
 *   inflates the estimate when the *current* run is retrying more than typical. It never double
 *   counts baseline retries and is damped so a single retry cannot make the ETA explode.
 */

export type EtaBasis = 'history' | 'current' | 'default'

export interface EtaRange {
  bestMs: number
  likelyMs: number
  worstMs: number
  basis: EtaBasis
}

export interface BeadSample {
  activeDurationMs: number
  iterations: number
}

/** Fallback per-bead duration when there is no history and no current-run data (4 minutes). */
export const DEFAULT_MS_PER_BEAD = 4 * 60 * 1000
/** EMA weight for the newest sample; also damps the retry-pressure spike. */
export const EMA_ALPHA = 0.4
/** Minimum history samples required before we trust historical throughput over the current run. */
export const MIN_HISTORY_SAMPLES = 5
/** Retry pressure is clamped so a burst of retries cannot more than double the estimate. */
export const MAX_RETRY_PRESSURE = 2

function positiveDurations(samples: BeadSample[]): number[] {
  return samples
    .map((sample) => sample.activeDurationMs)
    .filter((value) => Number.isFinite(value) && value > 0)
}

/** Linear-interpolation percentile over an unsorted array. `p` is in [0, 1]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0] ?? 0
  const clampedP = Math.min(1, Math.max(0, p))
  const rank = clampedP * (sorted.length - 1)
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)
  const weight = rank - lowIndex
  const low = sorted[lowIndex] ?? 0
  const high = sorted[highIndex] ?? low
  return low * (1 - weight) + high * weight
}

/** Exponential moving average over `values` ordered oldest -> newest. */
export function ema(values: number[], alpha: number = EMA_ALPHA): number {
  if (values.length === 0) return 0
  return values.reduce((acc, value, index) => (index === 0 ? value : alpha * value + (1 - alpha) * acc), 0)
}

/** Average attempts per bead (>= 1). Returns 1 when there are no samples. */
export function retryRate(samples: BeadSample[]): number {
  if (samples.length === 0) return 1
  const totalIterations = samples.reduce((acc, sample) => acc + Math.max(1, sample.iterations || 1), 0)
  return totalIterations / samples.length
}

/**
 * Computes the ETA range for the remaining beads.
 *
 * @param remaining          beads left to complete
 * @param historySamples     bucket-matched samples from prior runs (already fallback-selected)
 * @param currentRunSamples  this ticket's completed-bead samples, ordered oldest -> newest
 */
export function computeEtaRange(input: {
  remaining: number
  historySamples: BeadSample[]
  currentRunSamples: BeadSample[]
}): EtaRange | null {
  const { remaining, historySamples, currentRunSamples } = input
  if (!Number.isFinite(remaining) || remaining <= 0) return null

  const historyDurations = positiveDurations(historySamples)
  const currentDurations = positiveDurations(currentRunSamples)

  // Fallback hierarchy: rich bucket history -> current run -> sparse history -> default constant.
  let basis: EtaBasis
  let center: number
  let low: number
  let high: number
  let baselineSamples: BeadSample[]

  if (historyDurations.length >= MIN_HISTORY_SAMPLES) {
    basis = 'history'
    center = percentile(historyDurations, 0.5)
    low = percentile(historyDurations, 0.25)
    high = percentile(historyDurations, 0.75)
    baselineSamples = historySamples
  } else if (currentDurations.length >= 1) {
    basis = 'current'
    // Smooth the center so one slow/retried bead does not spike the estimate.
    center = ema(currentDurations)
    low = percentile(currentDurations, 0.25)
    high = percentile(currentDurations, 0.75)
    // With few samples the percentile spread collapses; widen it around the smoothed center.
    if (currentDurations.length < 4) {
      low = Math.min(low || center, center * 0.75)
      high = Math.max(high || center, center * 1.4)
    }
    baselineSamples = currentRunSamples
  } else if (historyDurations.length >= 1) {
    basis = 'history'
    center = percentile(historyDurations, 0.5)
    low = percentile(historyDurations, 0.25)
    high = percentile(historyDurations, 0.75)
    // Sparse history is better than a hardcoded default, but keep the range honest.
    if (historyDurations.length < 4) {
      low = Math.min(low || center, center * 0.6)
      high = Math.max(high || center, center * 1.8)
    }
    baselineSamples = historySamples
  } else {
    basis = 'default'
    center = DEFAULT_MS_PER_BEAD
    low = DEFAULT_MS_PER_BEAD * 0.6
    high = DEFAULT_MS_PER_BEAD * 1.8
    baselineSamples = []
  }

  // Retry pressure: how much more the current run is retrying vs the baseline. Ratio normalised to
  // baseline (=> 1x means "as expected"), clamped so it can only inflate, then damped.
  const baselineRetry = retryRate(baselineSamples)
  const currentRetry = currentRunSamples.length > 0 ? retryRate(currentRunSamples) : baselineRetry
  const rawPressure = baselineRetry > 0 ? currentRetry / baselineRetry : 1
  const clampedPressure = Math.min(MAX_RETRY_PRESSURE, Math.max(1, rawPressure))
  const pressure = 1 + EMA_ALPHA * (clampedPressure - 1)

  const values = [low, center, high]
    .map((perBead) => Math.round(remaining * perBead * pressure))
    .sort((a, b) => a - b)

  return {
    bestMs: values[0] ?? 0,
    likelyMs: values[1] ?? 0,
    worstMs: values[2] ?? 0,
    basis,
  }
}
