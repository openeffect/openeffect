/**
 * Path-based routing — uses pushState/popstate for real URL paths.
 *
 * URL patterns:
 *   /                            → gallery
 *   /effects                     → gallery
 *   /effects/:uuid               → effect view
 *   /effects/:uuid?run=X         → effect with run opened
 *   /effects/:uuid/edit          → effect editor
 */

export type ParsedRoute =
  | { page: 'gallery' }
  | { page: 'effect'; effectId: string; runId: string | null }
  | { page: 'edit'; effectId: string }

export function parseRoute(url?: string): ParsedRoute {
  if (!url && typeof window === 'undefined') return { page: 'gallery' }

  const pathname = url ?? window.location.pathname
  const search = url ? '' : window.location.search

  // /effects/:uuid/edit
  const editMatch = pathname.match(/^\/effects\/([^/]+)\/edit$/)
  if (editMatch) {
    return { page: 'edit', effectId: editMatch[1]! }
  }

  // /effects/:uuid
  const effectMatch = pathname.match(/^\/effects\/([^/]+)$/)
  if (effectMatch) {
    const params = new URLSearchParams(search)
    const runId = params.get('run')
    return { page: 'effect', effectId: effectMatch[1]!, runId }
  }

  return { page: 'gallery' }
}

export function navigate(path: string, query?: Record<string, string>): void {
  if (typeof window === 'undefined') return

  let url = path
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query)
    url = `${path}?${params}`
  }

  const current = window.location.pathname + window.location.search
  if (url === current) return

  window.history.pushState(null, '', url)
  // Dispatch popstate so listeners pick it up
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function replaceRoute(path: string, query?: Record<string, string>): void {
  if (typeof window === 'undefined') return

  let url = path
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query)
    url = `${path}?${params}`
  }

  window.history.replaceState(null, '', url)
}

/**
 * Initialize the popstate listener. Called once from effectsStore after effects are loaded.
 */
export function initRouteListener(
  onEffect: (effectId: string, runId: string | null) => void,
  onEdit: (effectId: string) => void,
  onGallery: () => void,
): void {
  if (typeof window === 'undefined') return

  window.addEventListener('popstate', () => {
    const route = parseRoute()
    if (route.page === 'effect') {
      onEffect(route.effectId, route.runId)
    } else if (route.page === 'edit') {
      onEdit(route.effectId)
    } else {
      onGallery()
    }
  })
}
