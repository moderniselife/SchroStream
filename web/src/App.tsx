import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import Dashboard from './Dashboard'
import Player from './Player'
import Control from './Control'

function Home() {
  const [searchParams] = useSearchParams()
  const streamId = searchParams.get('stream')
  
  if (streamId) {
    return <Player guildId={streamId} />
  }
  
  return <Dashboard />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/control" element={<Control />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
