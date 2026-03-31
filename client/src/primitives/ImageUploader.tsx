import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

interface ImageUploaderProps {
  label: string
  hint?: string
  value: File | null
  onChange: (file: File | null) => void
  restoredUrl?: string | null
}

export function ImageUploader({ label, hint, value, onChange, restoredUrl }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // Use restored URL as preview if no local preview
  const displayPreview = preview || restoredUrl || null
  const [dragActive, setDragActive] = useState(false)

  // Revoke blob URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const handleFile = useCallback(
    (file: File) => {
      onChange(file)
      const url = URL.createObjectURL(file)
      setPreview(url)
    },
    [onChange],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const clear = useCallback(() => {
    onChange(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [onChange, preview])

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed p-5 text-center transition-colors',
          dragActive
            ? 'border-primary bg-accent-dim'
            : 'border-border bg-muted hover:border-foreground/20',
        )}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
        {displayPreview ? (
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
              <Upload size={28} className="text-muted-foreground opacity-50" />
            )}
            <p className="text-xs text-secondary-foreground">
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
