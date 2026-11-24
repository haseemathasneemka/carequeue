import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { HOME_FOR_ROLE, useAuth } from '../AuthContext'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={HOME_FOR_ROLE[user.role]} replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const u = await login(username, password)
      navigate(location.state?.from || HOME_FOR_ROLE[u.role], { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container narrow">
      <form className="card" onSubmit={submit}>
        <h2>Staff login</h2>
        <p className="muted">For admin, reception and doctors.</p>
        <label htmlFor="username">Username</label>
        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="alert error">{error}</div>}
        <button className="btn full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
