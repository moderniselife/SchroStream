import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Pause, Volume2, RefreshCw, Tv, Radio, Zap } from 'lucide-react'
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
  const [refreshing, setRefreshing] = useState(false)

  const loadStreams = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const response = await fetch('/api/streams')
      const data = await response.json()
      setStreams(data.streams || [])
    } catch (error) {
      console.error('Failed to load streams:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadStreams()
    const interval = setInterval(() => loadStreams(), 5000)
    return () => clearInterval(interval)
  }, [])

  const handleStreamClick = (guildId: string) => {
    navigate(`/player/${guildId}`)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-violet-900/15 via-transparent to-transparent" />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <Tv className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-white tracking-tight">SchroStream</h1>
                  <p className="text-xs text-zinc-500">Live Media Streaming</p>
                </div>
              </div>
              <button
                onClick={() => loadStreams(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-sm text-zinc-300 hover:text-white transition-all duration-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-6 py-12">
          {/* Stats bar */}
          <div className="flex items-center gap-6 mb-10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm text-zinc-400">{streams.length} Active Stream{streams.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Zap className="w-3.5 h-3.5" />
              <span>Auto-refresh enabled</span>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin mb-4" />
              <p className="text-zinc-500 text-sm">Loading streams...</p>
            </div>
          ) : streams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="w-20 h-20 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-6">
                <Radio className="w-8 h-8 text-zinc-600" />
              </div>
              <h2 className="text-xl font-medium text-zinc-300 mb-2">No active streams</h2>
              <p className="text-zinc-500 text-sm max-w-md text-center">
                Start streaming from Discord to see your streams appear here in real-time.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {streams.map((stream) => (
                <div
                  key={stream.guildId}
                  onClick={() => handleStreamClick(stream.guildId)}
                  className="group relative rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] backdrop-blur-sm transition-all duration-300 cursor-pointer overflow-hidden shadow-xl shadow-black/20 hover:shadow-purple-500/5"
                >
                  {/* Thumbnail */}
                  {stream.thumbnail && (
                    <div className="relative aspect-video overflow-hidden">
                      <img
                        src={stream.thumbnail}
                        alt={stream.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          e.currentTarget.parentElement!.style.display = 'none'
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent" />
                      
                      {/* Live indicator */}
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/10">
                        <div className={`w-1.5 h-1.5 rounded-full ${stream.isPaused ? 'bg-amber-500' : 'bg-red-500 animate-pulse'}`} />
                        <span className="text-[10px] font-medium text-white uppercase tracking-wider">
                          {stream.isPaused ? 'Paused' : 'Live'}
                        </span>
                      </div>

                      {/* Type badge */}
                      <div className="absolute top-3 right-3">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md backdrop-blur-sm border ${
                          stream.type === 'plex' 
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' 
                            : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        }`}>
                          {stream.type}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-5">
                    <h3 className="font-medium text-white mb-3 line-clamp-2 leading-snug group-hover:text-purple-200 transition-colors">
                      {stream.title}
                    </h3>

                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-500 to-violet-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(stream.percentage, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        {stream.isPaused ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        <span>{formatTime(stream.currentTime)} / {formatTime(stream.duration)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <Volume2 className="w-3 h-3" />
                        <span>{stream.volume}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Hover glow effect */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-violet-500/5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/[0.06] mt-20">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span>SchroStream • Discord Media Streaming</span>
              <span>Built with ♥</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default Dashboard
