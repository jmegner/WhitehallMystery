import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './GameApp.tsx'
import BuildFooter from './BuildFooter.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <BuildFooter />
  </StrictMode>,
)
