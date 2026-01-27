/**
 * In-memory caching utilities for Lambda
 *
 * Note: These caches reset on cold start and are not shared across Lambda instances.
 * They're designed to reduce database queries within a single request or warm instance.
 */

import type { Session } from '../../src/types'
import type { Goal } from '../../src/models/orm'

// Session cache
const sessionCache = new Map<string, { session: Session; expires: number }>()

/**
 * Get a session from cache
 */
export function getSession(key: string): Session | null {
  const cached = sessionCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.session
  }
  sessionCache.delete(key)
  return null
}

/**
 * Store a session in cache
 */
export function setSession(key: string, session: Session, ttlSeconds = 1800): void {
  sessionCache.set(key, {
    session,
    expires: Date.now() + ttlSeconds * 1000,
  })
}

/**
 * Delete a session from cache
 */
export function deleteSession(key: string): void {
  sessionCache.delete(key)
}

// Goal cache - stores goals per site for fast lookup during collect
const goalCache = new Map<string, { goals: Goal[]; expires: number }>()
const GOAL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get cached goals for a site
 */
export function getCachedGoals(siteId: string): Goal[] | null {
  const cached = goalCache.get(siteId)
  if (cached && cached.expires > Date.now()) {
    return cached.goals
  }
  goalCache.delete(siteId)
  return null
}

/**
 * Store goals in cache
 */
export function setCachedGoals(siteId: string, goals: Goal[]): void {
  goalCache.set(siteId, {
    goals,
    expires: Date.now() + GOAL_CACHE_TTL,
  })
}

/**
 * Invalidate goal cache for a site
 */
export function invalidateGoalCache(siteId: string): void {
  goalCache.delete(siteId)
}

// Session conversion deduplication - prevents same goal from converting multiple times per session
const sessionConversions = new Map<string, Set<string>>()

/**
 * Check if a goal has already been converted in this session
 */
export function hasConverted(siteId: string, sessionId: string, goalId: string): boolean {
  const key = `${siteId}:${sessionId}`
  const converted = sessionConversions.get(key)
  return converted?.has(goalId) ?? false
}

/**
 * Mark a goal as converted for this session
 */
export function markConverted(siteId: string, sessionId: string, goalId: string): void {
  const key = `${siteId}:${sessionId}`
  let converted = sessionConversions.get(key)
  if (!converted) {
    converted = new Set<string>()
    sessionConversions.set(key, converted)
  }
  converted.add(goalId)

  // Clean up old session conversion entries (keep last 1000)
  if (sessionConversions.size > 1000) {
    const keysToDelete = Array.from(sessionConversions.keys()).slice(0, 100)
    keysToDelete.forEach(k => sessionConversions.delete(k))
  }
}

/**
 * Get all converted goals for a session
 */
export function getConvertedGoals(siteId: string, sessionId: string): Set<string> {
  const key = `${siteId}:${sessionId}`
  return sessionConversions.get(key) || new Set()
}

// Generic cache for any data
const genericCache = new Map<string, { data: unknown; expires: number }>()

/**
 * Get data from generic cache
 */
export function getFromCache<T>(key: string): T | null {
  const cached = genericCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.data as T
  }
  genericCache.delete(key)
  return null
}

/**
 * Store data in generic cache
 */
export function setInCache<T>(key: string, data: T, ttlMs: number): void {
  genericCache.set(key, {
    data,
    expires: Date.now() + ttlMs,
  })
}

/**
 * Clear all caches (useful for testing)
 */
export function clearAllCaches(): void {
  sessionCache.clear()
  goalCache.clear()
  sessionConversions.clear()
  genericCache.clear()
}
