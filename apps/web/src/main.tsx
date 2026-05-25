import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { CoachAccessPage } from './CoachAccessPage'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isCoachAccessRoute = pathname === '/coach-access'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCoachAccessRoute ? <CoachAccessPage /> : <App />}
  </StrictMode>,
)
