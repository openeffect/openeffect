import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { TooltipProvider } from '@/components/ui/Tooltip'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={150}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
