import { useRef, useState } from 'react'
import { Loader2, Upload, X, ImageIcon } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Label } from '@/components/ui/Label'

interface ImageUploaderProps {
  label: string
  hint?: string
  required?: boolean
  /** When true, paints a red border on the dropzone to flag a missing required value. */
  error?: boolean
  value: File | null
  onChange: (file: File | null) => void
  restoredUrl?: string | null
  /** Active-upload signal. Hides any preview and shows a centered spinner
   *  with "Uploading…" — matches FileDropzone's busy state for visual
   *  consistency. While true, the dropzone can't be re-clicked (the parent
   *  also disables Generate until upload completes). */
  uploading?: boolean
  /** Surfaced when the parent's eager upload fails. Painted as small
   *  destructive-colored text below the cell, matching the asset/zip
   *  install error patterns. The parent owns clearing this on re-pick. */
  errorMessage?: string | null
}

export function ImageUploader({ label, hint, required, error, value, onChange, restoredUrl, uploading, errorMessage }: ImageUploaderProps) {
  // Required-field validation paints the dropzone red. An upload error
  // doesn't — it shows up as plain destructive-colored text below the
  // empty cell, matching the asset / zip-install error pattern.
  const showErrorBorder = !!error
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  // Preview is server-driven now: parents eagerly upload on pick and pass
  // back `restoredUrl` (the 512.webp thumbnail) once the upload settles.
  // The brief File-only window in between is covered by the `uploading`
  // spinner, so we never need a local blob URL. The only place blob URLs
  // *could* still appear is the failed-upload state — but the file name
  // in the empty-state cell is honest UX in that case (the file isn't on
  // the server, no preview is real).

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) onChange(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onChange(file)
  }

  const clear = () => {
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { if (uploading) { e.preventDefault(); return } handleDrop(e) }}
        onClick={() => { if (!uploading) inputRef.current?.click() }}
        className={cn(
          'relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed p-5 text-center transition-colors',
          dragActive
            ? 'border-primary bg-accent-dim'
            : showErrorBorder
              ? 'border-destructive bg-destructive/5 hover:border-destructive'
              : 'border-border bg-muted hover:border-foreground/20',
          uploading && 'pointer-events-none',
        )}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Uploading…</p>
          </div>
        ) : restoredUrl ? (
          <div className="relative inline-block">
            <img
              src={restoredUrl}
              alt="Preview"
              loading="lazy"
              decoding="async"
              className="mx-auto max-h-36 rounded-lg object-cover shadow-md"
            />
            <button
              onClick={(e) => { e.stopPropagation(); clear() }}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white transition-transform hover:scale-110"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            {value ? (
              <ImageIcon size={28} className="text-primary" />
            ) : (
              <Upload size={28} className="text-muted-foreground opacity-40" />
            )}
            <p className="text-xs text-muted-foreground">
              {value ? value.name : 'Click or drag to upload'}
            </p>
          </div>
        )}
      </div>
      {errorMessage ? (
        <p className="text-[11px] text-destructive">{errorMessage}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
