import { useNuxtApp } from '#imports'
import type { ErrorReporter } from '../../../core'

/**
 * Composable to access the error tracker instance.
 * Auto-imported by the module — no manual import needed.
 *
 * Returns `null` if the tracker was not initialized (missing config).
 */
export function useErrorTracker(): ErrorReporter | null {
  return useNuxtApp().$errorTracker as ErrorReporter | null
}
