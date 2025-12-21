import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './Dashboard'
import Player from './Player'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/player/:guildId" element={<Player />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
