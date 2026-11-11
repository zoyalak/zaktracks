import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { SyncError } from '../lib/sync'
import { CloverLogo, Notice } from './ui'

/**
 * Account gate. The app keeps every log tied to the signed-in account, so the
 * same email on a new phone pulls the same history instead of starting over.
 */
export default function Auth() {
  const { signIn, signUp } = useApp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switching = mode === 'signup'

  const submit = async () => {
    if (busy) return
    const mail = email.trim()
    if (!mail) {
      setError('Enter your email address.')
      return
    }
    if (switching && password.length < 8) {
      setError('Use a password of at least 8 characters.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (switching) await signUp(mail, password)
      else await signIn(mail, password)
    } catch (err) {
      setError(
        err instanceof SyncError ? err.message : 'Something went wrong — try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <div
        className="center"
        style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}
      >
        <div style={{ width: '100%', maxWidth: 380 }}>
          <CloverLogo
            size={46}
            className="brand-dot"
            style={{ margin: '0 auto 14px', display: 'block' }}
          />
          <h1 style={{ textAlign: 'center', marginBottom: 6 }}>ZakTracks</h1>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 18 }}>
            {switching
              ? 'Create an account so your logs follow you to any device.'
              : 'Sign in to load your meals, goals and weight history.'}
          </p>

          <div className="card">
            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                placeholder="you@example.com"
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="input"
                type="password"
                autoComplete={switching ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                placeholder={switching ? 'At least 8 characters' : 'Your password'}
                disabled={busy}
              />
            </div>

            {error && <Notice type="error">{error}</Notice>}

            <button className="btn primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Please wait…' : switching ? 'Create account' : 'Sign in'}
            </button>

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setMode(switching ? 'signin' : 'signup')
                  setError(null)
                }}
              >
                {switching ? 'I already have an account' : 'Create a new account'}
              </button>
            </div>
          </div>

          <p className="tiny muted" style={{ textAlign: 'center', marginTop: 14 }}>
            Your logs are stored in your account and stay separate from everyone
            else&apos;s. Nothing is shared between accounts.
          </p>
        </div>
      </div>
    </div>
  )
}
