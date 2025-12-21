import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Volume2, Clock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
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

function Player() {
  const { guildId } = useParams<{ guildId: string }>()
  const navigate = useNavigate()
  const [stream, setStream] = useState<StreamInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoInitializedRef = useRef(false)

  // Initialize video source once
  useEffect(() => {
    if (videoRef.current && !videoInitializedRef.current && guildId) {
      videoRef.current.src = `/api/stream/${guildId}/hls`
      videoInitializedRef.current = true
      console.log('[Player] Video source set')
    }
  }, [guildId])

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
    const interval = setInterval(loadStreamInfo, 10000) // Refresh every 10s instead of 5s
    return () => clearInterval(interval)
  }, [guildId])

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center p-4">
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm max-w-md w-full">
          <CardContent className="py-10 text-center">
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <Button onClick={() => navigate('/')} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Streams
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!stream) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading stream...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
      <div className="bg-white/5 border-b border-white/10 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button
            onClick={() => navigate('/')}
            variant="ghost"
            className="text-white hover:bg-white/10"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="text-center flex-1">
            <h1 className="text-xl font-bold text-white">{stream.title}</h1>
            {stream.year && <p className="text-sm text-white/60">{stream.year}</p>}
          </div>
          <div className="w-24"></div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <Card className="bg-black border-white/10 overflow-hidden">
            <CardContent className="p-0">
              <video
                ref={videoRef}
                controls
                className="w-full aspect-video bg-black"
                autoPlay
              >
                Your browser does not support the video tag.
              </video>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Stream Information</CardTitle>
                <Badge
                  variant={stream.type === 'plex' ? 'default' : 'secondary'}
                  className={
                    stream.type === 'plex'
                      ? 'bg-orange-500 hover:bg-orange-600'
                      : 'bg-green-500 hover:bg-green-600'
                  }
                >
                  {stream.type.toUpperCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                  <Clock className="h-4 w-4" />
                  Duration
                </div>
                <div className="text-white text-lg font-semibold">
                  {formatTime(stream.duration)}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                  <Play className="h-4 w-4" />
                  Progress
                </div>
                <div className="text-white text-lg font-semibold">
                  {Math.round(stream.percentage)}%
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                  {stream.isPaused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  Status
                </div>
                <div className="text-white text-lg font-semibold">
                  {stream.isPaused ? 'Paused' : 'Playing'}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
                  <Volume2 className="h-4 w-4" />
                  Volume
                </div>
                <div className="text-white text-lg font-semibold">
                  {stream.volume}%
                </div>
              </div>
            </CardContent>
          </Card>

          {stream.description && (
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white/80 leading-relaxed">{stream.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default Player
