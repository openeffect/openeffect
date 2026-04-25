import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { cn } from '@/utils/cn'

interface FileDropzoneProps {
  accept?: string
  label?: string
  disabled?: boolean
  /** Active-upload signal. Swaps the upload icon for a spinner and the
   *  label for `busyLabel`, and blocks further clicks while in flight.
   *  `disabled` would also block clicks but gives no positive feedback —
   *  use `busy` whenever there's actual work happening behind the scenes. */
  busy?: boolean
  busyLabel?: string
  onFile: (file: File) => void
  className?: string
}

export function FileDropzone({
  accept,
  label = 'Click or drag to upload',
  disabled,
  busy,
  busyLabel = 'Uploading…',
  onFile,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const blocked = disabled || busy

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (blocked) return
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!blocked) setDragActive(true) }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => { if (!blocked) inputRef.current?.click() }}
      className={cn(
        'flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors',
        dragActive
          ? 'border-primary bg-accent-dim'
          : 'border-border bg-muted hover:border-foreground/20',
        blocked && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      {busy ? (
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      ) : (
        <Upload size={16} className="text-muted-foreground opacity-40" />
      )}
      <p className="text-xs text-muted-foreground">{busy ? busyLabel : label}</p>
    </div>
  )
}
