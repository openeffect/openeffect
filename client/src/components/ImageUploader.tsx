import { useEffect, useRef, useState } from 'react'
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
}

export function ImageUploader({ label, hint, required, error, value, onChange, restoredUrl, uploading }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // Use restored URL as preview if no local preview
  const displayPreview = preview || restoredUrl || null
  const [dragActive, setDragActive] = useState(false)

  // Generate the blob preview URL from `value` and revoke it on swap or
  // unmount. This makes the effect the single source of truth for the
  // preview lifecycle, so a File arriving via *any* path (drag-drop,
  // file picker, parent-controlled props like the cross-effect carry)
  // gets a thumbnail. setState-in-effect is the right tool here because
  // we need both a render-visible URL string AND a guaranteed cleanup
  // when value changes — useMemo can't run cleanup, and computing during
  // render would orphan blob URLs on every re-render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!value) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    // The useEffect above handles preview revocation when value transitions
    // to null — we just clear the file input and tell the parent.
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
            : error
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
        ) : displayPreview ? (
          <div className="relative inline-block">
            <img
              src={displayPreview}
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
      {hint && (
        <p className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
