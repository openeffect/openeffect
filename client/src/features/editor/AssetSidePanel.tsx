import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, Film, Trash2, Pencil, Check, X } from 'lucide-react'
import { useStore } from '@/store'
import { selectAssetFiles } from '@/store/selectors/editorSelectors'
import { api } from '@/utils/api'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { FileDropzone } from '@/components/FileDropzone'
import type { AssetFile } from '@/store/types'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
// Rail width matches the expanded-header height so the two chrome strips
// read as the same-thickness bar — one rotated 90° relative to the other.
const RAIL_WIDTH = 32
const PANEL_WIDTH = 320
// Same easing as Layout.tsx so panel / right-drawer animations feel unified.
const EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]

export function AssetSidePanel({ effectId }: { effectId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const storeFiles = useStore(selectAssetFiles)
  const [files, setFiles] = useState(storeFiles)
  // Sync from store when it changes (e.g. on open). React's "storing info
  // from previous renders" pattern — setState-in-effect would cascade.
  const [prevStoreFiles, setPrevStoreFiles] = useState(storeFiles)
  if (storeFiles !== prevStoreFiles) {
    setPrevStoreFiles(storeFiles)
    setFiles(storeFiles)
  }
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // effectId is a UUID — resolve to namespace/slug for API calls.
  const effect = useStore((s) => s.effects.items.get(effectId))
  const ns = effect?.namespace
  const slug = effect?.slug

  const handleUpload = async (file: File) => {
    if (!ns || !slug) return
    try {
      const result = await api.uploadAsset(ns, slug, file)
      setFiles((prev) => [...prev, result])
    } catch {
      // ignore
    }
  }

  const handleDelete = async (filename: string) => {
    if (!ns || !slug) return
    try {
      await api.deleteAsset(ns, slug, filename)
      setFiles((prev) => prev.filter((f) => f.filename !== filename))
    } catch {
      // ignore
    }
  }

  const startRename = (filename: string) => {
    setRenamingFile(filename)
    setRenameValue(filename)
  }

  const handleRename = async () => {
    if (!ns || !slug || !renamingFile || !renameValue.trim()) return
    if (renameValue === renamingFile) {
      setRenamingFile(null)
      return
    }
    try {
      const result = await api.renameAsset(ns, slug, renamingFile, renameValue.trim())
      setFiles((prev) =>
        prev.map((f) => f.filename === renamingFile ? { ...f, filename: result.filename, url: result.url } : f),
      )
      setRenamingFile(null)
    } catch {
      // ignore
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

          {/* Upload — pinned to top */}
          <div className="shrink-0 border-b p-3">
            <FileDropzone onFile={handleUpload} label="Click or drag to upload asset" />
          </div>

          {/* File list — only this scrolls */}
          <div className="flex-1 space-y-1 overflow-y-auto p-3">
            {sortedFiles.map((f) => (
              <FileRow
                key={f.filename}
                file={f}
                isRenaming={renamingFile === f.filename}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onStartRename={() => startRename(f.filename)}
                onConfirmRename={handleRename}
                onCancelRename={() => setRenamingFile(null)}
                onDelete={() => handleDelete(f.filename)}
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

function FileRow({
  file,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onDelete,
}: {
  file: AssetFile
  isRenaming: boolean
  renameValue: string
  onRenameValueChange: (v: string) => void
  onStartRename: () => void
  onConfirmRename: () => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? ''
  const isImage = IMAGE_EXTS.has(ext)

  const handleConfirmDelete = () => {
    setConfirmingDelete(false)
    onDelete()
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border p-2">
      {/* Thumbnail */}
      {isImage ? (
        <a href={file.url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={file.url}
            alt={file.filename}
            className="h-8 w-8 rounded object-cover"
          />
        </a>
      ) : (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted"
        >
          <Film size={14} className="text-muted-foreground" />
        </a>
      )}

      {/* Middle — rename input or filename */}
      {isRenaming ? (
        <Input
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirmRename()
            if (e.key === 'Escape') onCancelRename()
          }}
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
              onClick={onConfirmRename}
              className="rounded-md p-1 text-success hover:bg-success/15"
              title="Save"
            >
              <Check size={12} />
            </button>
            <button
              onClick={onCancelRename}
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </>
        ) : confirmingDelete ? (
          <>
            <button
              onClick={handleConfirmDelete}
              className="rounded-md p-1 text-destructive hover:bg-destructive/15"
              title="Confirm delete"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onStartRename}
              className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
