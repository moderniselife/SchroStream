import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState } from 'react'
import Dashboard from './Dashboard'
import Player from './Player'
import Control from './Control'

function Home({ activeStreamId, setActiveStreamId }: { activeStreamId: string | null, setActiveStreamId: (id: string | null) => void }) {
  if (activeStreamId) {
    return <Player guildId={activeStreamId} onBack={() => setActiveStreamId(null)} />
  }
  
  return <Dashboard onStreamSelect={setActiveStreamId} />
}

function App() {
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home activeStreamId={activeStreamId} setActiveStreamId={setActiveStreamId} />} />
        <Route path="/control" element={<Control />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
