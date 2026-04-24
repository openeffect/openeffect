import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/utils/cn'

interface FileDropzoneProps {
  accept?: string
  label?: string
  disabled?: boolean
  onFile: (file: File) => void
  className?: string
}

export function FileDropzone({ accept, label = 'Click or drag to upload', disabled, onFile, className }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
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
      onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors',
        dragActive
          ? 'border-primary bg-accent-dim'
          : 'border-border bg-muted hover:border-foreground/20',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <Upload size={16} className="text-muted-foreground opacity-40" />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
