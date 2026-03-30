import { Download, Sparkles, X } from 'lucide-react'
import { VideoPlayer } from '@/components/primitives/VideoPlayer/VideoPlayer'
import { useGenerationStore } from '@/store/generationStore'

interface ResultViewerProps {
  jobId: string
}

export function ResultViewer({ jobId }: ResultViewerProps) {
  const job = useGenerationStore((s) => s.activeJobs.get(jobId))
  const closeJob = useGenerationStore((s) => s.closeJob)

  if (!job || !job.videoUrl) return null

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = job.videoUrl!
    a.download = `${job.effectName.replace(/\s+/g, '-').toLowerCase()}.mp4`
    a.click()
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {job.effectName}
        </h3>
        <button
          onClick={closeJob}
          className="rounded-lg p-1.5 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1">
        <VideoPlayer src={job.videoUrl} autoPlay />
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={handleDownload}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}
        >
          <Download size={16} />
          Download MP4
        </button>
        <button
          onClick={closeJob}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
        >
          <Sparkles size={16} />
          New effect
        </button>
      </div>
    </div>
  )
}
