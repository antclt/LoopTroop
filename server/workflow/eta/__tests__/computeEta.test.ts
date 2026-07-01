import { describe, expect, it } from 'vitest'
import {
  computeEtaRange,
  ema,
  percentile,
  retryRate,
  DEFAULT_MS_PER_BEAD,
  EMA_ALPHA,
  MAX_RETRY_PRESSURE,
  type BeadSample,
} from '../computeEta'

/** Convenience builder for throughput samples. */
function sample(activeDurationMs: number, iterations = 1): BeadSample {
  return { activeDurationMs, iterations }
}

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([], 0.5)).toBe(0)
  })

  it('returns the only value for a single-element array', () => {
    expect(percentile([42], 0.5)).toBe(42)
  })

  it('linearly interpolates between neighbouring ranks', () => {
    const values = [40, 10, 30, 20] // intentionally unsorted
    expect(percentile(values, 0)).toBe(10)
    expect(percentile(values, 1)).toBe(40)
    expect(percentile(values, 0.5)).toBe(25)
    expect(percentile(values, 0.25)).toBe(17.5)
    expect(percentile(values, 0.75)).toBe(32.5)
  })

  it('clamps p outside [0, 1]', () => {
    expect(percentile([10, 20, 30], -1)).toBe(10)
    expect(percentile([10, 20, 30], 5)).toBe(30)
  })
})

describe('ema', () => {
  it('returns 0 for an empty array', () => {
    expect(ema([])).toBe(0)
  })

  it('returns the seed value for a single sample', () => {
    expect(ema([1000])).toBe(1000)
  })

  it('weights the newest sample by alpha', () => {
    // idx0 seeds at 10; idx1 = alpha*20 + (1-alpha)*10
    expect(ema([10, 20], 0.4)).toBeCloseTo(14, 10)
  })
})

describe('retryRate', () => {
  it('is 1 with no samples', () => {
    expect(retryRate([])).toBe(1)
  })

  it('averages attempts per bead', () => {
    expect(retryRate([sample(1, 1), sample(1, 1), sample(1, 2)])).toBeCloseTo(4 / 3, 10)
  })

  it('treats missing/zero iterations as a single attempt', () => {
    expect(retryRate([sample(1, 0), { activeDurationMs: 1 } as BeadSample])).toBe(1)
  })
})

describe('computeEtaRange', () => {
  it('returns null when nothing remains or the count is not finite', () => {
    expect(computeEtaRange({ remaining: 0, historySamples: [], currentRunSamples: [] })).toBeNull()
    expect(computeEtaRange({ remaining: -3, historySamples: [], currentRunSamples: [] })).toBeNull()
    expect(computeEtaRange({ remaining: Number.NaN, historySamples: [], currentRunSamples: [] })).toBeNull()
  })

  it('uses historical throughput once enough samples exist', () => {
    const history = Array.from({ length: 6 }, () => sample(1000, 1))
    const eta = computeEtaRange({ remaining: 10, historySamples: history, currentRunSamples: [] })
    expect(eta).not.toBeNull()
    expect(eta?.basis).toBe('history')
    // Flat history → best = likely = worst = remaining * perBead.
    expect(eta).toMatchObject({ bestMs: 10000, likelyMs: 10000, worstMs: 10000 })
  })

  it('falls back to the current run when history is insufficient', () => {
    const current = [sample(800), sample(1200), sample(1000), sample(1000)]
    const eta = computeEtaRange({ remaining: 5, historySamples: [sample(1000)], currentRunSamples: current })
    expect(eta?.basis).toBe('current')
    // best <= likely <= worst must always hold.
    expect(eta!.bestMs).toBeLessThanOrEqual(eta!.likelyMs)
    expect(eta!.likelyMs).toBeLessThanOrEqual(eta!.worstMs)
  })

  it('uses sparse history before the hardcoded default when the current run has no samples', () => {
    const eta = computeEtaRange({
      remaining: 2,
      historySamples: [sample(10_000), sample(20_000)],
      currentRunSamples: [],
    })
    expect(eta?.basis).toBe('history')
    expect(eta?.likelyMs).toBe(30_000)
    expect(eta!.bestMs).toBeLessThan(eta!.likelyMs)
    expect(eta!.worstMs).toBeGreaterThan(eta!.likelyMs)
  })

  it('widens the spread around the smoothed center with very few current samples', () => {
    const eta = computeEtaRange({ remaining: 2, historySamples: [], currentRunSamples: [sample(1000)] })
    expect(eta?.basis).toBe('current')
    // center 1000 widened to [750, 1400] * remaining 2.
    expect(eta).toMatchObject({ bestMs: 1500, likelyMs: 2000, worstMs: 2800 })
  })

  it('uses the default constant when there is no data at all', () => {
    const eta = computeEtaRange({ remaining: 3, historySamples: [], currentRunSamples: [] })
    expect(eta?.basis).toBe('default')
    expect(eta).toMatchObject({
      bestMs: Math.round(3 * DEFAULT_MS_PER_BEAD * 0.6),
      likelyMs: 3 * DEFAULT_MS_PER_BEAD,
      worstMs: Math.round(3 * DEFAULT_MS_PER_BEAD * 1.8),
    })
  })

  it('inflates the estimate when the current run retries more than the baseline', () => {
    const history = Array.from({ length: 6 }, () => sample(1000, 1))
    const calm = computeEtaRange({ remaining: 10, historySamples: history, currentRunSamples: [] })
    const retrying = computeEtaRange({
      remaining: 10,
      historySamples: history,
      currentRunSamples: [sample(5000, 4)], // 4 attempts vs baseline 1
    })
    expect(retrying!.likelyMs).toBeGreaterThan(calm!.likelyMs)
    // Pressure is clamped to MAX_RETRY_PRESSURE and damped by EMA_ALPHA.
    const expectedPressure = 1 + EMA_ALPHA * (MAX_RETRY_PRESSURE - 1)
    expect(retrying!.likelyMs).toBe(Math.round(calm!.likelyMs * expectedPressure))
  })

  it('never lets retry pressure more than double the estimate', () => {
    const history = Array.from({ length: 6 }, () => sample(1000, 1))
    const extreme = computeEtaRange({
      remaining: 10,
      historySamples: history,
      currentRunSamples: [sample(9000, 50)], // absurd retry burst
    })
    const calmLikely = 10000
    expect(extreme!.likelyMs).toBeLessThanOrEqual(calmLikely * MAX_RETRY_PRESSURE)
  })
})
