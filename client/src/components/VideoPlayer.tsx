import { useRef, useState, useEffect } from 'react'
import { Play, Pause, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface VideoPlayerProps {
  src: string
}

export function VideoPlayer({ src }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Click-to-play: result videos start paused so the user is ready to
  // watch (and hear) the generated output. The `onPlay`/`onPause`
  // listeners below drive the icon from real element state.
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) video.pause()
    else video.play()
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Number(e.target.value)
  }

  const fullscreen = () => {
    videoRef.current?.requestFullscreen?.()
  }

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="overflow-hidden rounded-lg bg-card">
      <video
        ref={videoRef}
        src={src}
        loop
        playsInline
        className="max-h-[60vh] w-full"
      />
      <div className="flex items-center gap-3 border-t p-3">
        <button
          onClick={togglePlay}
          className="rounded-full bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-accent-hover"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={seek}
          className="flex-1"
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <Button variant="ghost" size="icon" onClick={fullscreen} className="h-7 w-7 opacity-60">
          <Maximize2 size={14} />
        </Button>
      </div>
    </div>
  )
}
