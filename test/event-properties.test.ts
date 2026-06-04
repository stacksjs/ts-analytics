/**
 * Tests for aggregateEventProperties (src/handlers/stats.ts) — the pure
 * group-by-event-key-value aggregator behind GET /event-properties.
 */

import { describe, expect, it } from 'bun:test'
import { aggregateEventProperties } from '../src/handlers/stats'

describe('aggregateEventProperties', () => {
  it('groups by event -> key -> value with counts and unique visitors', () => {
    const events = [
      { name: 'signup', visitorId: 'a', properties: { plan: 'pro' } },
      { name: 'signup', visitorId: 'a', properties: { plan: 'pro' } }, // same visitor
      { name: 'signup', visitorId: 'b', properties: { plan: 'free' } },
    ]
    const { eventProperties, byEvent, total } = aggregateEventProperties(events)
    expect(eventProperties.find(r => r.value === 'pro')).toEqual({ event: 'signup', key: 'plan', value: 'pro', count: 2, visitors: 1 })
    expect(eventProperties.find(r => r.value === 'free')).toEqual({ event: 'signup', key: 'plan', value: 'free', count: 1, visitors: 1 })
    expect(byEvent.signup).toBe(3)
    expect(total).toBe(3)
  })

  it('coerces numbers and booleans to stable string buckets', () => {
    const { eventProperties } = aggregateEventProperties([
      { name: 'x', visitorId: 'a', properties: { n: 1, b: true } },
    ])
    expect(eventProperties.find(r => r.key === 'n')?.value).toBe('1')
    expect(eventProperties.find(r => r.key === 'b')?.value).toBe('true')
  })

  it('skips reserved name/value keys and non-primitive values', () => {
    const { eventProperties } = aggregateEventProperties([
      { name: 'x', visitorId: 'a', properties: { name: 'x', value: 5, plan: 'pro', nested: { a: 1 } } },
    ])
    const keys = eventProperties.map(r => r.key)
    expect(keys).toContain('plan')
    expect(keys).not.toContain('name')
    expect(keys).not.toContain('value')
    expect(keys).not.toContain('nested')
  })

  it('counts events without properties in byEvent/total but emits no rows', () => {
    const { eventProperties, byEvent, total } = aggregateEventProperties([
      { name: 'x', visitorId: 'a' },
      { name: 'x', visitorId: 'b', properties: null },
    ])
    expect(eventProperties).toHaveLength(0)
    expect(byEvent.x).toBe(2)
    expect(total).toBe(2)
  })

  it('sorts values by count desc and respects the per-key limit', () => {
    const events: Array<{ name: string, visitorId: string, properties: Record<string, any> }> = []
    for (let i = 0; i < 5; i++) events.push({ name: 'e', visitorId: `v${i}`, properties: { k: 'rare' } })
    for (let i = 0; i < 10; i++) events.push({ name: 'e', visitorId: `w${i}`, properties: { k: 'common' } })
    const { eventProperties } = aggregateEventProperties(events, { limit: 1 })
    const kRows = eventProperties.filter(r => r.key === 'k')
    expect(kRows).toHaveLength(1)
    expect(kRows[0].value).toBe('common')
    expect(kRows[0].count).toBe(10)
  })
})
