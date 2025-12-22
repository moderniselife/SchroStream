import { useState, useEffect } from 'react'
import { Play, Pause, StopCircle, FastForward, Rewind, Volume2, Search, Youtube, Link, SkipForward, Clock } from 'lucide-react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'

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
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-violet-900/15 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
              Stream Control
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Control your streams from the web</p>
          </div>
          <a href="/" className="text-zinc-400 hover:text-white transition-colors">
            ← Back to Dashboard
          </a>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`p-4 rounded-lg border ${message.includes('failed') || message.includes('error') ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
            {message}
          </div>
        )}

        {/* Active Stream Info */}
        {activeStream && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Now Playing</CardTitle>
              <CardDescription className="text-zinc-400">{activeStream.title}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-zinc-400">
                <span>{Math.floor(activeStream.currentTime / 60000)}:{String(Math.floor((activeStream.currentTime % 60000) / 1000)).padStart(2, '0')}</span>
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-violet-500"
                    style={{ width: `${(activeStream.currentTime / activeStream.duration) * 100}%` }}
                  />
                </div>
                <span>{Math.floor(activeStream.duration / 60000)}:{String(Math.floor((activeStream.duration % 60000) / 1000)).padStart(2, '0')}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Playback Controls */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Playback Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Button
                onClick={() => executeCommand('pause')}
                disabled={loading || !activeStream}
                className="bg-white/10 hover:bg-white/20 border-white/20"
              >
                {activeStream?.isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                {activeStream?.isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                onClick={() => executeCommand('stop')}
                disabled={loading || !activeStream}
                className="bg-white/10 hover:bg-white/20 border-white/20"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop
              </Button>
              <Button
                onClick={() => executeCommand('skip')}
                disabled={loading || !activeStream}
                className="bg-white/10 hover:bg-white/20 border-white/20"
              >
                <SkipForward className="w-4 h-4 mr-2" />
                Skip
              </Button>
              <Button
                onClick={() => executeCommand('ff', { time: '30s' })}
                disabled={loading || !activeStream}
                className="bg-white/10 hover:bg-white/20 border-white/20"
              >
                <FastForward className="w-4 h-4 mr-2" />
                +30s
              </Button>
            </div>

            {/* Seek */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Time (e.g., 1:30:00)"
                value={seekTime}
                onChange={(e) => setSeekTime(e.target.value)}
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
              <Button
                onClick={() => {
                  executeCommand('seek', { time: seekTime })
                  setSeekTime('')
                }}
                disabled={loading || !activeStream || !seekTime}
                className="bg-purple-500 hover:bg-purple-600"
              >
                <Clock className="w-4 h-4 mr-2" />
                Seek
              </Button>
            </div>

            {/* Volume */}
            <div className="flex gap-2 items-center">
              <Volume2 className="w-4 h-4 text-zinc-400" />
              <input
                type="range"
                min="0"
                max="200"
                value={volumeLevel}
                onChange={(e) => setVolumeLevel(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm text-zinc-400 w-12">{volumeLevel}%</span>
              <Button
                onClick={() => executeCommand('volume', { level: volumeLevel })}
                disabled={loading || !activeStream}
                className="bg-white/10 hover:bg-white/20 border-white/20"
              >
                Set
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Search & Play */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Search & Play</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search Type Toggle */}
            <div className="flex gap-2">
              <Button
                onClick={() => setSearchType('plex')}
                className={searchType === 'plex' ? 'bg-purple-500' : 'bg-white/10 hover:bg-white/20 border-white/20'}
              >
                <Search className="w-4 h-4 mr-2" />
                Plex
              </Button>
              <Button
                onClick={() => setSearchType('youtube')}
                className={searchType === 'youtube' ? 'bg-purple-500' : 'bg-white/10 hover:bg-white/20 border-white/20'}
              >
                <Youtube className="w-4 h-4 mr-2" />
                YouTube
              </Button>
            </div>

            {/* Search Input */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={`Search ${searchType === 'plex' ? 'Plex library' : 'YouTube'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
              <Button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                className="bg-purple-500 hover:bg-purple-600"
              >
                Search
              </Button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="text-white font-medium">{result.title}</p>
                      <p className="text-xs text-zinc-500">{result.year || result.channel}</p>
                    </div>
                    <Button
                      onClick={() => handlePlay(index)}
                      disabled={loading}
                      className="bg-purple-500 hover:bg-purple-600"
                      size="sm"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Direct URL Input */}
            <div className="pt-4 border-t border-white/10 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="YouTube URL"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
                <Button
                  onClick={() => {
                    executeCommand('youtube', { url: youtubeUrl })
                    setYoutubeUrl('')
                  }}
                  disabled={loading || !youtubeUrl}
                  className="bg-red-500 hover:bg-red-600"
                >
                  <Youtube className="w-4 h-4 mr-2" />
                  Play
                </Button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Direct Stream URL (M3U8, MP4, etc.)"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
                <Button
                  onClick={() => {
                    executeCommand('url', { url: streamUrl })
                    setStreamUrl('')
                  }}
                  disabled={loading || !streamUrl}
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  <Link className="w-4 h-4 mr-2" />
                  Play
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Control
