import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './state/AppContext'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)

// Progressive web app: prompt for install once the browser suggests it.
let deferredInstall: Event | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e
  window.dispatchEvent(new CustomEvent('macrolens:installable', { detail: true }))
})
window.addEventListener('macrolens:install', () => {
  const evt = deferredInstall as (Event & { prompt?: () => Promise<void> }) | null
  evt?.prompt?.().catch(() => undefined)
  deferredInstall = null
})
