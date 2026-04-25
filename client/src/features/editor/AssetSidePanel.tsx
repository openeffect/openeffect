import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { selectAssetFiles } from '@/store/selectors/editorSelectors'
import {
  addEditorAsset,
  removeEditorAsset,
  renameEditorAsset,
} from '@/store/actions/editorActions'
import { api } from '@/utils/api'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { FileDropzone } from '@/components/FileDropzone'
import type { AssetFile } from '@/store/types'

// Rail width matches the expanded-header height so the two chrome strips
// read as the same-thickness bar — one rotated 90° relative to the other.
const RAIL_WIDTH = 32
const PANEL_WIDTH = 320
// Same easing as Layout.tsx so panel / right-drawer animations feel unified.
const EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]

export function AssetSidePanel({ effectId }: { effectId: string }) {
  // The store's assetFiles slice mirrors what the server has bound to
  // the effect. Add/rename/delete each call the per-asset endpoint
  // before mutating local state, so save is purely a YAML update.
  const files = useStore(selectAssetFiles)
  // effectId is a UUID — resolve to namespace/slug for API calls.
  const effect = useStore((s) => s.effects.items.get(effectId))
  const ns = effect?.namespace
  const slug = effect?.slug
  const isPersisted = ns !== undefined && slug !== undefined

  const [isOpen, setIsOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleUpload = async (file: File) => {
    if (!ns || !slug) return
    setUploadError(null)
    setUploading(true)
    try {
      const result = await api.uploadEffectAsset(ns, slug, file)
      addEditorAsset({
        filename: result.filename,
        size: result.size,
        url: result.url,
        id: result.id,
      })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const count = files.length
  // Finder-style natural sort: "file2" before "file10", case-insensitive.
  const sortedFiles = [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }),
  )

  return (
    <motion.aside
      animate={{ width: isOpen ? PANEL_WIDTH : RAIL_WIDTH }}
      initial={false}
      transition={{ duration: 0.22, ease: EASE }}
      className="shrink-0 overflow-hidden border-l bg-background"
    >
      {isOpen ? (
        <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
          {/* Header — click to collapse */}
          <button
            onClick={() => setIsOpen(false)}
            className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs font-semibold text-secondary-foreground hover:text-foreground"
          >
            <ChevronLeft size={14} className="rotate-180 transition-transform" />
            Assets
            {count > 0 && <Badge className="ml-1">{count}</Badge>}
          </button>

          {/* Upload — pinned to top. Disabled until the effect has been
              saved at least once, since asset bindings need an effect_id
              to attach to. */}
          <div className="shrink-0 space-y-2 border-b p-3">
            {isPersisted ? (
              <FileDropzone
                onFile={handleUpload}
                label="Click or drag to upload asset"
                accept="image/*,video/mp4,video/webm"
                busy={uploading}
              />
            ) : (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                Save the effect first to attach assets.
              </div>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>

          {/* File list — only this scrolls */}
          <div className="flex-1 space-y-1 overflow-y-auto p-3">
            {sortedFiles.map((f) => (
              <FileRow
                key={f.filename}
                file={f}
                ns={ns ?? ''}
                slug={slug ?? ''}
              />
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="flex h-full w-full flex-col items-center justify-center gap-2 py-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          style={{ width: RAIL_WIDTH }}
          title="Show assets"
        >
          {count > 0 && (
            <Badge className="[writing-mode:vertical-rl] rotate-180">{count}</Badge>
          )}
          <span className="[writing-mode:vertical-rl] rotate-180">Assets</span>
          <ChevronLeft size={14} className="transition-transform" />
        </button>
      )}
    </motion.aside>
  )
}

/** A row owns its own busy + error state so feedback lands inline,
 *  next to whichever file the user is acting on. Mirrors the
 *  ManagedEffectRow pattern in EffectsManagerDialog where the confirm
 *  button itself swaps to a spinner. */
function FileRow({
  file,
  ns,
  slug,
}: {
  file: AssetFile
  ns: string
  slug: string
}) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(file.filename)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState<'rename' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Every image and video has a `512.webp` on disk (Pillow thumbnail for
  // images, ffmpeg poster frame for videos) — the file-store's contract.
  // No need to check.
  const thumbnailUrl = `/api/files/${file.id}/512.webp`

  const startRename = () => {
    setIsRenaming(true)
    setRenameValue(file.filename)
    setError(null)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setError(null)
  }

  const confirmRename = async () => {
    const next = renameValue.trim()
    if (!next || next === file.filename) {
      cancelRename()
      return
    }
    setError(null)
    setBusy('rename')
    try {
      const result = await api.renameEffectAsset(ns, slug, file.filename, next)
      renameEditorAsset(file.filename, result.filename)
      setIsRenaming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setBusy(null)
    }
  }

  const confirmDelete = async () => {
    setError(null)
    setBusy('delete')
    try {
      await api.deleteEffectAsset(ns, slug, file.filename)
      removeEditorAsset(file.filename)
      // No need to clear local state — the row unmounts as the parent
      // list drops this entry from the store.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setBusy(null)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 p-2">
        {/* Thumbnail — clicks open the original. */}
        <a href={file.url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={thumbnailUrl}
            alt={file.filename}
            className="h-8 w-8 rounded object-cover"
          />
        </a>

        {/* Middle — rename input or filename */}
        {isRenaming ? (
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') cancelRename()
            }}
            disabled={busy === 'rename'}
            className="h-6 flex-1 py-0 text-xs"
            autoFocus
          />
        ) : (
          <span className="flex-1 truncate text-xs text-foreground">{file.filename}</span>
        )}

        {/* Actions — swap to confirm/cancel while renaming or confirming delete */}
        <div className="flex shrink-0 items-center gap-0.5">
          {isRenaming ? (
            <>
              <button
                onClick={confirmRename}
                disabled={busy !== null}
                className="rounded-md p-1 text-success hover:bg-success/15 disabled:opacity-60"
                title="Save"
              >
                {busy === 'rename' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
              </button>
              <button
                onClick={cancelRename}
                disabled={busy !== null}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-60"
                title="Cancel"
              >
                <X size={12} />
              </button>
            </>
          ) : confirmingDelete ? (
            <>
              <button
                onClick={confirmDelete}
                disabled={busy !== null}
                className="rounded-md p-1 text-destructive hover:bg-destructive/15 disabled:opacity-60"
                title="Confirm delete"
              >
                {busy === 'delete' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={busy !== null}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-60"
                title="Cancel"
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startRename}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                title="Rename"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => { setConfirmingDelete(true); setError(null) }}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline error — sits inside the row's border, anchored under
          the file it concerns. Same `text-xs` as the filename. */}
      {error && <p className="px-2 pb-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
