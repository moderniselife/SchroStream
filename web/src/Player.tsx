import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, Play, Pause, Volume2, Clock, Tv, AlertCircle, ChevronRight } from 'lucide-react'
import { formatTime } from './lib/utils'

interface StreamInfo {
  guildId: string
  title: string
  description?: string
  type: 'plex' | 'external'
  streamUrl: string
  duration: number
  currentTime: number
  percentage: number
  isPaused: boolean
  volume: number
  thumbnail?: string
  year?: number
}

interface PlayerProps {
  guildId: string
  onBack?: () => void
}

function Player({ guildId, onBack }: PlayerProps) {
  const [stream, setStream] = useState<StreamInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoInitializedRef = useRef(false)

  // Initialize video source once (after stream metadata loads and video element mounts)
  useEffect(() => {
    if (videoRef.current && !videoInitializedRef.current && guildId && stream) {
      const proxyUrl = `/api/stream/${guildId}/hls`
      console.log('[Player] Setting video source:', proxyUrl)
      videoRef.current.src = proxyUrl
      videoInitializedRef.current = true
    }
  }, [guildId, stream])

  // Refresh metadata only (no video source changes)
  useEffect(() => {
    const loadStreamInfo = async () => {
      try {
        const response = await fetch(`/api/stream/${guildId}`)
        if (!response.ok) throw new Error('Stream not found')
        const data = await response.json()
        setStream(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stream')
      }
    }

    loadStreamInfo()
    const interval = setInterval(loadStreamInfo, 10000)
    return () => clearInterval(interval)
  }, [guildId])

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl" />
        </div>
        
        <div className="relative z-10 max-w-md w-full">
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-sm p-8 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">Stream Error</h2>
            <p className="text-zinc-400 mb-6">{error}</p>
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-sm text-zinc-300 hover:text-white transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Streams
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!stream) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin mb-4" />
          <p className="text-zinc-500 text-sm">Loading stream...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-violet-900/15 via-transparent to-transparent" />
      </div>

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/[0.08] bg-black/40 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.05] text-zinc-400 hover:text-white transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>
              
              <div className="h-6 w-px bg-white/10" />
              
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/20">
                  <Tv className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-medium text-white truncate">{stream.title}</h1>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                      stream.type === 'plex' 
                        ? 'bg-orange-500/20 text-orange-400' 
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}>
                      {stream.type}
                    </span>
                    {stream.year && (
                      <>
                        <ChevronRight className="w-3 h-3" />
                        <span>{stream.year}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Video Player */}
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="space-y-6">
            {/* Video Container */}
            <div className="rounded-2xl overflow-hidden bg-black border border-white/[0.06] shadow-2xl shadow-black/50">
              <video
                ref={videoRef}
                controls
                autoPlay
                muted
                playsInline
                className="w-full aspect-video bg-black"
              >
                Your browser does not support the video tag.
              </video>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-zinc-500 text-xs mb-3">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wider">Duration</span>
                </div>
                <div className="text-2xl font-semibold text-white tabular-nums">
                  {formatTime(stream.duration)}
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-zinc-500 text-xs mb-3">
                  <Play className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wider">Progress</span>
                </div>
                <div className="text-2xl font-semibold text-white">
                  {Math.min(Math.round(stream.percentage), 100)}%
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-zinc-500 text-xs mb-3">
                  {stream.isPaused ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span className="uppercase tracking-wider">Status</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${stream.isPaused ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
                  <span className="text-2xl font-semibold text-white">
                    {stream.isPaused ? 'Paused' : 'Live'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-zinc-500 text-xs mb-3">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wider">Volume</span>
                </div>
                <div className="text-2xl font-semibold text-white">
                  {stream.volume}%
                </div>
              </div>
            </div>

            {/* Description */}
            {stream.description && (
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 backdrop-blur-sm">
                <h3 className="text-sm font-medium text-zinc-400 mb-3 uppercase tracking-wider">Description</h3>
                <p className="text-zinc-300 leading-relaxed">{stream.description}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Player
