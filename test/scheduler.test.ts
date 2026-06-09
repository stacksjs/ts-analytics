import { describe, expect, it } from 'bun:test'
import { isDue, registeredJobs, registerJob } from '../src/lib/scheduler'

describe('isDue', () => {
  it('is due when never run', () => {
    expect(isDue(null, 60_000, 1_000_000)).toBe(true)
  })

  it('is due once the interval has elapsed', () => {
    expect(isDue(1000, 5000, 6000)).toBe(true)
    expect(isDue(1000, 5000, 6001)).toBe(true)
  })

  it('is not due before the interval elapses', () => {
    expect(isDue(1000, 5000, 5999)).toBe(false)
  })
})

describe('registerJob', () => {
  it('registers a job and dedupes by name', () => {
    const before = registeredJobs().length
    registerJob({ name: 'test-job-x', intervalMs: 1000, run: async () => {} })
    registerJob({ name: 'test-job-x', intervalMs: 1000, run: async () => {} })
    const after = registeredJobs().filter(j => j.name === 'test-job-x')
    expect(after.length).toBe(1)
    expect(registeredJobs().length).toBe(before + 1)
  })
})
