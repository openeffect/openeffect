/**
 * Hash-based routing — shared between stores to avoid circular dependencies.
 */

type ParsedHash =
  | { mode: 'effect'; id: string }
  | { mode: 'generation'; id: string }
  | null

export function parseHash(raw?: string): ParsedHash {
  const hash = raw ?? (typeof window !== 'undefined' ? window.location.hash.slice(1) : '')
  if (!hash) return null
  if (hash.startsWith('effects/')) return { mode: 'effect', id: hash.slice(8) }
  if (hash.startsWith('generations/')) return { mode: 'generation', id: hash.slice(12) }
  return null
}

export function writeHash(path: string | null) {
  if (typeof window === 'undefined') return
  const current = window.location.hash.slice(1)
  if (path === current) return
  if (path) {
    window.history.pushState(null, '', `#${path}`)
  } else {
    window.history.pushState(null, '', window.location.pathname)
  }
}

/**
 * Initialize the popstate listener. Called once from effectsStore after effects are loaded.
 * Separated here so both stores can be imported without circular deps.
 */
export function initPopstateListener(
  onEffect: (id: string | null) => void,
  onGeneration: (id: string) => void,
  onEmpty: () => void,
  isValidEffect: (id: string) => boolean,
) {
  if (typeof window === 'undefined') return

  window.addEventListener('popstate', () => {
    const parsed = parseHash()
    if (parsed?.mode === 'effect') {
      onEffect(isValidEffect(parsed.id) ? parsed.id : null)
    } else if (parsed?.mode === 'generation') {
      onGeneration(parsed.id)
    } else {
      onEmpty()
    }
  })
}
