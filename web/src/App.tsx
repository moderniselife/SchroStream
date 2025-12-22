import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './Dashboard'
import Player from './Player'
import Control from './Control'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/player/:guildId" element={<Player />} />
        <Route path="/control" element={<Control />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
