import { useCallback, useRef, useState } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'

interface ImageUploaderProps {
  label: string
  hint?: string
  accept?: string[]
  maxSizeMb?: number
  value: File | null
  onChange: (file: File | null) => void
}

export function ImageUploader({ label, hint, accept, maxSizeMb = 10, value, onChange }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024) {
        alert(`File too large. Maximum size is ${maxSizeMb}MB.`)
        return
      }
      onChange(file)
      const url = URL.createObjectURL(file)
      setPreview(url)
    },
    [maxSizeMb, onChange],
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

  const acceptStr = accept?.join(',') ?? 'image/*'

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed p-5 text-center"
        style={{
          borderColor: dragActive ? 'var(--accent)' : 'var(--border)',
          background: dragActive ? 'var(--accent-dim)' : 'var(--surface-elevated)',
        }}
      >
        <input ref={inputRef} type="file" accept={acceptStr} onChange={handleChange} className="hidden" />
        {preview ? (
          <div className="relative inline-block">
            <img src={preview} alt="Preview" className="mx-auto max-h-36 rounded-lg object-cover" style={{ boxShadow: 'var(--shadow)' }} />
            <button
              onClick={(e) => { e.stopPropagation(); clear() }}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-white"
              style={{ background: 'var(--danger)' }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            {value ? (
              <ImageIcon size={28} style={{ color: 'var(--accent)' }} />
            ) : (
              <Upload size={28} style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
            )}
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {value ? value.name : 'Click or drag to upload'}
            </p>
          </div>
        )}
      </div>
      {hint && (
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
