import { useState, useEffect } from 'react'
import { Play, Pause, StopCircle, FastForward, Volume2, Search, Youtube, Link, SkipForward, Clock } from 'lucide-react'

interface Stream {
  guildId: string
  title: string
  currentTime: number
  duration: number
  isPaused: boolean
  volume: number
}

function Control() {
  const [activeStream, setActiveStream] = useState<Stream | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Search states
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchType, setSearchType] = useState<'plex' | 'youtube'>('plex')

  // Command inputs
  const [seekTime, setSeekTime] = useState('')
  const [volumeLevel, setVolumeLevel] = useState(100)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [streamUrl, setStreamUrl] = useState('')

  useEffect(() => {
    loadActiveStream()
    const interval = setInterval(loadActiveStream, 3000)
    return () => clearInterval(interval)
  }, [])

  const loadActiveStream = async () => {
    try {
      const response = await fetch('/api/streams')
      const data = await response.json()
      if (data.streams && data.streams.length > 0) {
        setActiveStream(data.streams[0])
      } else {
        setActiveStream(null)
      }
    } catch (error) {
      console.error('Failed to load stream:', error)
    }
  }

  const showMessage = (msg: string, isError = false) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }

  const executeCommand = async (endpoint: string, body?: any) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/control/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json()
      
      if (data.success) {
        showMessage(data.message || 'Command executed successfully')
        loadActiveStream()
      } else {
        showMessage(data.error || 'Command failed', true)
      }
    } catch (error) {
      showMessage('Failed to execute command', true)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    
    setLoading(true)
    try {
      const endpoint = searchType === 'plex' ? 'search' : 'youtube-search'
      const response = await fetch(`/api/control/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      })
      const data = await response.json()
      
      if (data.success) {
        setSearchResults(data.results || [])
        showMessage(`Found ${data.results?.length || 0} results`)
      } else {
        showMessage(data.error || 'Search failed', true)
      }
    } catch (error) {
      showMessage('Search failed', true)
    } finally {
      setLoading(false)
    }
  }

  const handlePlay = async (index: number) => {
    await executeCommand('play', { number: index + 1 })
    setSearchResults([])
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white relative overflow-hidden">
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

      <div className="relative z-10 max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="border-b border-white/[0.08] bg-black/40 backdrop-blur-xl sticky top-0 z-50 -mx-6 px-6 py-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
                Stream Control
              </h1>
              <p className="text-zinc-500 text-sm mt-1">Control your streams from the web</p>
            </div>
            <a href="/" className="text-zinc-400 hover:text-white transition-colors text-sm flex items-center gap-2">
              ← Back
            </a>
          </div>
        </header>

        {/* Message Banner */}
        {message && (
          <div className={`p-4 rounded-xl border backdrop-blur-xl shadow-lg ${message.includes('failed') || message.includes('error') ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
            {message}
          </div>
        )}

        {/* Active Stream Info */}
        {activeStream && (
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl backdrop-blur-xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white mb-1">Now Playing</h2>
              <p className="text-zinc-400 text-sm">{activeStream.title}</p>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 text-sm text-zinc-400">
                <span className="font-mono">{Math.floor(activeStream.currentTime / 60000)}:{String(Math.floor((activeStream.currentTime % 60000) / 1000)).padStart(2, '0')}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-300"
                    style={{ width: `${(activeStream.currentTime / activeStream.duration) * 100}%` }}
                  />
                </div>
                <span className="font-mono">{Math.floor(activeStream.duration / 60000)}:{String(Math.floor((activeStream.duration % 60000) / 1000)).padStart(2, '0')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Playback Controls */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold text-white">Playback Controls</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => executeCommand('pause')}
                disabled={loading || !activeStream}
                className="px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {activeStream?.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                {activeStream?.isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={() => executeCommand('stop')}
                disabled={loading || !activeStream}
                className="px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <StopCircle className="w-4 h-4" />
                Stop
              </button>
              <button
                onClick={() => executeCommand('skip')}
                disabled={loading || !activeStream}
                className="px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <SkipForward className="w-4 h-4" />
                Skip
              </button>
              <button
                onClick={() => executeCommand('ff', { time: '30s' })}
                disabled={loading || !activeStream}
                className="px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <FastForward className="w-4 h-4" />
                +30s
              </button>
            </div>

            {/* Seek */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Time (e.g., 1:30:00)"
                value={seekTime}
                onChange={(e) => setSeekTime(e.target.value)}
                className="flex-1 px-4 py-3 bg-white/[0.02] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
              />
              <button
                onClick={() => {
                  executeCommand('seek', { time: seekTime })
                  setSeekTime('')
                }}
                disabled={loading || !activeStream || !seekTime}
                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-purple-500/25"
              >
                <Clock className="w-4 h-4" />
                Seek
              </button>
            </div>

            {/* Volume */}
            <div className="flex gap-3 items-center">
              <Volume2 className="w-5 h-5 text-zinc-400 shrink-0" />
              <input
                type="range"
                min="0"
                max="200"
                value={volumeLevel}
                onChange={(e) => setVolumeLevel(Number(e.target.value))}
                className="flex-1 h-2 bg-white/5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-purple-500 [&::-webkit-slider-thumb]:to-violet-500 [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <span className="text-sm text-zinc-400 w-12 font-mono">{volumeLevel}%</span>
              <button
                onClick={() => executeCommand('volume', { level: volumeLevel })}
                disabled={loading || !activeStream}
                className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Set
              </button>
            </div>
          </div>
        </div>

        {/* Search & Play */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold text-white">Search & Play</h2>
          </div>
          <div className="p-6 space-y-4">
            {/* Search Type Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setSearchType('plex')}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  searchType === 'plex'
                    ? 'bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white'
                }`}
              >
                <Search className="w-4 h-4" />
                Plex
              </button>
              <button
                onClick={() => setSearchType('youtube')}
                className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  searchType === 'youtube'
                    ? 'bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white'
                }`}
              >
                <Youtube className="w-4 h-4" />
                YouTube
              </button>
            </div>

            {/* Search Input */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={`Search ${searchType === 'plex' ? 'Plex library' : 'YouTube'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-4 py-3 bg-white/[0.02] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
              />
              <button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/25"
              >
                Search
              </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl hover:bg-white/[0.05] hover:border-white/[0.1] transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{result.title}</p>
                      <p className="text-xs text-zinc-500 mt-1">{result.year || result.channel}</p>
                    </div>
                    <button
                      onClick={() => handlePlay(index)}
                      disabled={loading}
                      className="ml-4 p-3 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/25 group-hover:scale-105"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Direct URL Input */}
            <div className="pt-4 border-t border-white/[0.06] space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="YouTube URL"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="flex-1 px-4 py-3 bg-white/[0.02] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-all"
                />
                <button
                  onClick={() => {
                    executeCommand('youtube', { url: youtubeUrl })
                    setYoutubeUrl('')
                  }}
                  disabled={loading || !youtubeUrl}
                  className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-red-500/25"
                >
                  <Youtube className="w-4 h-4" />
                  Play
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Direct Stream URL (M3U8, MP4, etc.)"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  className="flex-1 px-4 py-3 bg-white/[0.02] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                <button
                  onClick={() => {
                    executeCommand('url', { url: streamUrl })
                    setStreamUrl('')
                  }}
                  disabled={loading || !streamUrl}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-blue-500/25"
                >
                  <Link className="w-4 h-4" />
                  Play
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Control
