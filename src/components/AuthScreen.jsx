import { useState } from 'react'
import './AuthScreen.css'

export default function AuthScreen({ onSubmit, error, busy }) {
  const [mode, setMode] = useState('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const register = mode === 'register'

  return <main className="auth-page">
    <div className="auth-brand"><span>◉</span> social cinema</div>
    <section className="auth-card">
      <div className="auth-popcorn">✦</div>
      <span className="eyebrow">YOUR FRONT ROW STARTS HERE</span>
      <h1>{register ? 'Save your seat.' : 'Good to see you.'}</h1>
      <p>{register ? 'Create an account, then bring your favorite people along.' : 'Sign in to create a cinema or join your friends.'}</p>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit({ mode, displayName, email, password }) }}>
        {register && <label>Your name<input autoComplete="name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How friends know you"/></label>}
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? 'At least 6 characters' : 'Your password'}/></label>
        {error && <div role="alert" className="auth-error">{error}</div>}
        <button disabled={busy} className="auth-submit">{busy ? 'One moment…' : register ? 'Create account' : 'Sign in'} <span>→</span></button>
      </form>
      <div className="auth-switch">{register ? 'Already have an account?' : 'New to Social Cinema?'} <button onClick={() => setMode(register ? 'signin' : 'register')}>{register ? 'Sign in' : 'Create an account'}</button></div>
      <div className="auth-private">🔒 Your rooms are invite-only. Your email is never shown to other guests.</div>
    </section>
  </main>
}
