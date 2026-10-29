import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './state/AppContext'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// Ask the browser not to evict this app's storage (IndexedDB/localStorage) in
// the background. Best effort: it can only be granted for an installed PWA or
// after interaction, and is ignored where unsupported — the localStorage
// mirror in lib/db.ts is the fallback either way.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  void navigator.storage.persist().catch(() => undefined)
}

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
