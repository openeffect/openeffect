import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy } from 'lucide-react'
import { cn } from '@/utils/cn'

/** Banner shown when the server reports `keyring_available: false`. Points
 *  users at the `FAL_KEY` env-var path first; lets them reveal the "save here
 *  anyway (plaintext in SQLite)" input behind a disclosure so they have to
 *  deliberately opt in to the lesser-security path.
 *
 *  Children are the fallback input; parent renders them only when the user
 *  expands the disclosure. */
export function KeyringFallbackNotice({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText('FAL_KEY=sk-your-key-here')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <div className="flex-1 space-y-1.5">
            <p className="font-semibold text-foreground">Secure storage isn't available here</p>
            <p className="leading-relaxed text-muted-foreground">
              No OS keyring was detected (typical for Docker / headless Linux). For
              production, set <code className="rounded bg-foreground/10 px-1 font-mono">FAL_KEY</code>{' '}
              via env var and restart — the app reads it without persisting anything.
            </p>
            <button
              onClick={handleCopy}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 font-mono text-[11px] text-foreground hover:bg-muted"
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              FAL_KEY=sk-your-key-here
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown size={12} className={cn('transition-transform', !expanded && '-rotate-90')} />
        {expanded ? 'Hide fallback input' : 'Save here anyway (plaintext in app database)'}
      </button>

      {expanded && <div className="pt-1">{children}</div>}
    </div>
  )
}
