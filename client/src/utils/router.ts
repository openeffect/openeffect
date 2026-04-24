/**
 * Path-based routing — uses pushState/popstate for real URL paths.
 *
 * URL patterns:
 *   /                            → gallery
 *   /?category=X&source=Y        → gallery with filters applied
 *   /effects/new                 → blank editor (new effect)
 *   /effects/:uuid               → effect view
 *   /effects/:uuid?run=X         → effect with run opened
 *   /effects/:uuid/edit          → effect editor
 *   /playground                  → playground
 *   /playground?model=...        → playground with restored form state
 *
 * The `category` / `source` query params are context: they live on whichever
 * page the user is on so browser-Back from a deep route lands in the right
 * filtered gallery. navigate() auto-preserves them unless overridden.
 */

import type { EffectSource } from '@/store/types'

export type Filters = { category: string; source: EffectSource; search: string }

export type ParsedRoute =
  | ({ page: 'gallery' } & Filters)
  | ({ page: 'effect'; effectId: string; runId: string | null } & Filters)
  | ({ page: 'edit'; effectId: string } & Filters)
  | { page: 'newEffect' }
  | ({ page: 'playground'; runId: string | null } & Filters)

const VALID_SOURCES: readonly EffectSource[] = ['all', 'official', 'mine', 'installed']

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const category = params.get('category') || 'all'
  const rawSource = params.get('source') as EffectSource | null
  const source = rawSource && VALID_SOURCES.includes(rawSource) ? rawSource : 'all'
  const q = params.get('search') || ''
  return { category, source, search: q }
}

export function parseRoute(url?: string): ParsedRoute {
  if (!url && typeof window === 'undefined') return { page: 'gallery', category: 'all', source: 'all', search: '' }

  const pathname = url ?? window.location.pathname
  const search = url ? '' : window.location.search

  // /playground
  if (pathname === '/playground') {
    const params = new URLSearchParams(search)
    return { page: 'playground', runId: params.get('run'), ...parseFilters(search) }
  }

  // /effects/new (must precede /effects/:uuid)
  if (pathname === '/effects/new') {
    return { page: 'newEffect' }
  }

  // /effects/:uuid/edit
  const editMatch = pathname.match(/^\/effects\/([^/]+)\/edit$/)
  if (editMatch) {
    return { page: 'edit', effectId: editMatch[1]!, ...parseFilters(search) }
  }

  // /effects/:uuid
  const effectMatch = pathname.match(/^\/effects\/([^/]+)$/)
  if (effectMatch) {
    const params = new URLSearchParams(search)
    const runId = params.get('run')
    return { page: 'effect', effectId: effectMatch[1]!, runId, ...parseFilters(search) }
  }

  return { page: 'gallery', ...parseFilters(search) }
}

/** Merge the caller's `query` with any filter params on the current URL so
 *  category/source context travels through every navigation for free. Caller's
 *  explicit values (including `undefined` or `'all'`) override; values equal
 *  to the filter default (`'all'`) are dropped from the output. */
function buildQuery(query?: Record<string, string | undefined>): URLSearchParams {
  const out = new URLSearchParams()
  const current = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const explicitKeys = new Set(query ? Object.keys(query) : [])

  for (const key of ['category', 'source', 'search'] as const) {
    if (explicitKeys.has(key)) continue
    const v = current.get(key)
    if (v && v !== 'all') out.set(key, v)
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      if ((key === 'category' || key === 'source') && value === 'all') continue
      out.set(key, value)
    }
  }
  return out
}

export function navigate(path: string, query?: Record<string, string | undefined>): void {
  if (typeof window === 'undefined') return

  const params = buildQuery(query)
  const qs = params.toString()
  const url = qs ? `${path}?${qs}` : path

  const current = window.location.pathname + window.location.search
  if (url === current) return

  window.history.pushState(null, '', url)
  // Dispatch popstate so listeners pick it up
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function replaceRoute(path: string, query?: Record<string, string | undefined>): void {
  if (typeof window === 'undefined') return

  const params = buildQuery(query)
  const qs = params.toString()
  const url = qs ? `${path}?${qs}` : path

  window.history.replaceState(null, '', url)
}

/**
 * Initialize the popstate listener. Called once from effectsStore after effects are loaded.
 * Gallery/effect/edit callbacks receive the filter context from the URL so they
 * can sync the store on every back/forward navigation.
 */
export function initRouteListener(
  onEffect: (effectId: string, runId: string | null, filters: Filters) => void,
  onEdit: (effectId: string, filters: Filters) => void,
  onGallery: (filters: Filters) => void,
  onPlayground: (runId: string | null, filters: Filters) => void,
  onNewEffect: () => void,
): void {
  if (typeof window === 'undefined') return

  window.addEventListener('popstate', () => {
    const route = parseRoute()
    if (route.page === 'effect') {
      onEffect(route.effectId, route.runId, { category: route.category, source: route.source, search: route.search })
    } else if (route.page === 'edit') {
      onEdit(route.effectId, { category: route.category, source: route.source, search: route.search })
    } else if (route.page === 'playground') {
      onPlayground(route.runId, { category: route.category, source: route.source, search: route.search })
    } else if (route.page === 'newEffect') {
      onNewEffect()
    } else {
      onGallery({ category: route.category, source: route.source, search: route.search })
    }
  })
}
