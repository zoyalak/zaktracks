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

// Keep the installed app fresh without reinstalling it. The worker is
// network-first for the shell, so a deployment is picked up on the next launch
// or while the app stays open; when a new worker takes control the page
// reloads once, and the signed-in session is untouched.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for an actual update — not on the very first install.
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        const check = () => void reg.update().catch(() => undefined)
        setInterval(check, 15 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
      })
      .catch(() => undefined)
  })
}

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
