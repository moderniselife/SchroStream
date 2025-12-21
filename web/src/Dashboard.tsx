import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Pause, Volume2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Progress } from './components/ui/progress'
import { formatTime } from './lib/utils'

interface Stream {
  guildId: string
  title: string
  type: 'plex' | 'external'
  duration: number
  currentTime: number
  percentage: number
  isPaused: boolean
  volume: number
  thumbnail?: string
}

function Dashboard() {
  const navigate = useNavigate()
  const [streams, setStreams] = useState<Stream[]>([])
  const [loading, setLoading] = useState(true)

  const loadStreams = async () => {
    try {
      const response = await fetch('/api/streams')
      const data = await response.json()
      setStreams(data.streams || [])
    } catch (error) {
      console.error('Failed to load streams:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStreams()
    const interval = setInterval(loadStreams, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleStreamClick = (guildId: string) => {
    navigate(`/player/${guildId}`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              🎬 SchroStream
            </h1>
            <p className="text-slate-400">Active Streams</p>
          </div>
          <Button
            onClick={loadStreams}
            variant="outline"
            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="text-center text-white py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Loading streams...</p>
          </div>
        ) : streams.length === 0 ? (
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardContent className="py-20 text-center">
              <p className="text-white text-lg">
                No active streams. Start streaming from Discord to see them here!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {streams.map((stream) => (
              <Card
                key={stream.guildId}
                className="bg-white/5 border-white/10 backdrop-blur-sm hover:bg-white/10 transition-all cursor-pointer group"
                onClick={() => handleStreamClick(stream.guildId)}
              >
                <CardHeader className="pb-3">
                  {stream.thumbnail && (
                    <div className="w-full h-48 mb-4 rounded-lg overflow-hidden bg-slate-800">
                      <img
                        src={stream.thumbnail}
                        alt={stream.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-white text-lg line-clamp-2">
                      {stream.title}
                    </CardTitle>
                  </div>
                  <CardDescription className="flex items-center gap-2 mt-2">
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
                    <span className="text-white/60 flex items-center gap-1">
                      {stream.isPaused ? (
                        <>
                          <Pause className="h-3 w-3" />
                          Paused
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3" />
                          Playing
                        </>
                      )}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={stream.percentage} className="h-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80">
                      {formatTime(stream.currentTime)} / {formatTime(stream.duration)}
                    </span>
                    <span className="text-white/60 flex items-center gap-1">
                      <Volume2 className="h-3 w-3" />
                      {stream.volume}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
