import { useEffect, useRef, useState } from 'react'
import { Save, Plus, Download, AlertCircle, Loader2, ChevronDown, Film, Trash2, Pencil, Check, X } from 'lucide-react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { indentWithTab } from '@codemirror/commands'
import { useStore, getState } from '@/store'
import {
  selectEditorYaml,
  selectSaveError,
  selectEditingEffectId,
  selectIsSaving,
  selectSavedManifest,
  selectEditorLastSavedYaml,
  selectAssetFiles,
} from '@/store/selectors/editorSelectors'
import {
  updateYaml,
  saveEffect,
  closeEditor,
  confirmClose,
} from '@/store/actions/editorActions'
import { selectEffect } from '@/store/actions/effectsActions'
import { api } from '@/utils/api'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { FileDropzone } from '@/components/FileDropzone'
import { cn } from '@/utils/cn'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--text-primary)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: '16px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--text-tertiary)',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
  },
  // The active-line background was opaque enough to sit on top of the
  // selection layer, so highlights on the current line looked invisible.
  // Using an alpha-blended background + double-selector override for the
  // selection keeps both visible regardless of editor focus state.
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  '&.cm-focused .cm-selectionBackground, & .cm-selectionBackground, &.cm-focused ::selection, & ::selection': {
    backgroundColor: 'rgba(74, 144, 226, 0.35) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(74, 144, 226, 0.15)',
    outline: 'none',
  },
  '.cm-line': {
    padding: '0 16px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: true })

const syntaxColors = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--syn-key)' },
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-keyword)' },
  { tag: tags.null, color: 'var(--syn-keyword)' },
  { tag: tags.comment, color: 'var(--syn-comment)' },
  { tag: tags.meta, color: 'var(--syn-meta)' },
  { tag: tags.atom, color: 'var(--syn-number)' },
  { tag: tags.punctuation, color: 'var(--syn-punctuation)' },
]))

export function EffectEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const yamlContent = useStore(selectEditorYaml)
  const saveError = useStore(selectSaveError)
  const editingEffectId = useStore(selectEditingEffectId)
  const isSaving = useStore(selectIsSaving)
  const savedManifest = useStore(selectSavedManifest)
  const lastSavedYaml = useStore(selectEditorLastSavedYaml)
  const isNew = !editingEffectId
  const isDirty = isNew || yamlContent !== lastSavedYaml

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return

    // Tab / Shift-Tab indent instead of escaping focus to the next browser
    // control (basicSetup does not bind Tab by default — deliberate, since
    // an always-on Tab trap hurts a11y; we opt in here).
    const editorKeymap = keymap.of([
      indentWithTab,
      {
        key: 'Mod-s',
        run: () => {
          const s = getState()
          if (s.editor.yamlContent !== s.editor.lastSavedYaml || !s.editor.editingEffectId) {
            saveEffect()
          }
          return true  // always prevent browser save dialog
        },
      },
    ])

    const state = EditorState.create({
      doc: yamlContent,
      extensions: [
        basicSetup,
        yaml(),
        darkTheme,
        syntaxColors,
        editorKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateYaml(update.state.doc.toString())
          }
        }),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExport = () => {
    if (!savedManifest) return
    window.open(api.exportEffect(savedManifest.namespace, savedManifest.slug), '_blank')
  }

  const handleClose = () => {
    if (!confirmClose()) return
    closeEditor()
    if (editingEffectId) {
      selectEffect(editingEffectId)
    } else {
      selectEffect(null)
    }
  }

  // Show the canonical `namespace/slug` — it's the stable handle
  // authors reference and matches how the effect is keyed in the
  // registry / URL, whereas the display `name` is free-form prose.
  // `savedManifest` is always populated when this header renders (both
  // `openEditor` and `openBlankEditor` set it synchronously before
  // isOpen flips); the empty-string fallback is purely for the
  // TypeScript null-check.
  const effectTitle = savedManifest?.full_id ?? ''

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Editor header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-foreground">{effectTitle}</h2>
          {editingEffectId ? (
            <Badge variant="accent">Editing</Badge>
          ) : (
            <Badge>Unsaved</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editingEffectId && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download size={14} />
              Export
            </Button>
          )}
          <Button size="sm" onClick={saveEffect} disabled={isSaving || !isDirty} className="bg-success text-white hover:bg-success/90">
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : isNew ? <Plus size={14} /> : <Save size={14} />}
            {isNew ? 'Create' : 'Save'}
          </Button>
          {editingEffectId && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose} title="Close editor">
              <X size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} className="min-h-0 flex-1 overflow-hidden" />

      {/* Asset panel */}
      {editingEffectId && <AssetPanel effectId={editingEffectId} />}

      {/* Save error */}
      {saveError && (
        <div className="shrink-0 border-t bg-destructive/5 px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{saveError}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Asset Panel ─── */

function AssetPanel({ effectId }: { effectId: string }) {
  const [isOpen, setIsOpen] = useState(true)
  const storeFiles = useStore(selectAssetFiles)
  const [files, setFiles] = useState(storeFiles)
  // Sync from store when it changes (e.g. on open) — React's "storing info
  // from previous renders" pattern. setState-in-effect would cascade renders.
  const [prevStoreFiles, setPrevStoreFiles] = useState(storeFiles)
  if (storeFiles !== prevStoreFiles) {
    setPrevStoreFiles(storeFiles)
    setFiles(storeFiles)
  }
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // effectId is a UUID — resolve to namespace/slug for API calls.
  const effect = useStore((s) => (effectId ? s.effects.items.get(effectId) : undefined))
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

  const ext = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? ''
  const isImage = (filename: string) => IMAGE_EXTS.has(ext(filename))

  return (
    <div className="shrink-0 border-t">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold text-secondary-foreground hover:text-foreground"
      >
        <ChevronDown size={14} className={cn('transition-transform', !isOpen && '-rotate-90')} />
        Assets
        {files.length > 0 && (
          <Badge className="ml-1">{files.length}</Badge>
        )}
      </button>

      {/* Content */}
      {isOpen && (
        <div className="space-y-2 px-4 pb-3">
          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f) => (
                <div key={f.filename} className="flex items-center gap-2 rounded-lg border p-2">
                  {/* Thumbnail */}
                  {isImage(f.filename) ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img
                        src={f.url}
                        alt={f.filename}
                        className="h-8 w-8 rounded object-cover"
                      />
                    </a>
                  ) : (
                    <a href={f.url} target="_blank" rel="noreferrer" className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                      <Film size={14} className="text-muted-foreground" />
                    </a>
                  )}

                  {/* Filename or rename input */}
                  {renamingFile === f.filename ? (
                    <div className="flex flex-1 items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenamingFile(null) }}
                        className="h-6 py-0 text-xs"
                        autoFocus
                      />
                      <button onClick={handleRename} className="shrink-0 text-success hover:text-success/80">
                        <Check size={12} />
                      </button>
                      <button onClick={() => setRenamingFile(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <span className="flex-1 truncate text-xs text-foreground">{f.filename}</span>
                  )}

                  {/* Actions */}
                  {renamingFile !== f.filename && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => startRename(f.filename)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => handleDelete(f.filename)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload */}
          <FileDropzone
            onFile={handleUpload}
            label="Drop or click to upload asset"
            className="py-3"
          />

        </div>
      )}
    </div>
  )
}
