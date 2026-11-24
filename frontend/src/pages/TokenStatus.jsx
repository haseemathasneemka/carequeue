import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useQueueRoom, useSocketStatus } from '../socket'
import StatusBadge, { formatMinutes, formatTime } from '../components/StatusBadge'

const MESSAGES = {
  called: 'It’s your turn! Please go to the doctor’s room now.',
  in_consultation: 'You are with the doctor.',
  completed: 'Your consultation is complete. Get well soon!',
  no_show: 'You were marked as not present. Please talk to the reception desk.',
  cancelled: 'This token was cancelled.',
}

export default function TokenStatus() {
  const { code } = useParams()
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const live = useSocketStatus()
  const lastStatus = useRef(null)

  const load = useCallback(() => {
    api(`/tokens/${code}`)
      .then((data) => {
        // Vibrate the phone when the patient is called
        if (data.status === 'called' && lastStatus.current === 'waiting' && navigator.vibrate) {
          navigator.vibrate([300, 150, 300])
        }
        lastStatus.current = data.status
        setToken(data)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [code])

  useEffect(() => {
    load()
    // Refresh once a minute too, so the time estimate keeps counting down
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  useQueueRoom(token ? `doctor_${token.doctor.id}` : null, (data) => {
    if (data.doctor_id === token?.doctor.id) load()
  })

  const cancel = async () => {
    if (!window.confirm('Cancel this token? You will lose your place in the queue.')) return
    setCancelling(true)
    try {
      await api(`/tokens/${code}/cancel`, { method: 'POST' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCancelling(false)
    }
  }

  if (error && !token) {
    return (
      <div className="container narrow center">
        <div className="alert error">{error}</div>
        <Link to="/" className="btn">Book a new token</Link>
      </div>
    )
  }
  if (!token) return <div className="container center muted">Loading…</div>

  const waiting = token.status === 'waiting'
  const yourTurn = token.status === 'called'

  return (
    <div className="container narrow">
      <div className={`card token-card ${yourTurn ? 'your-turn' : ''}`}>
        <div className="token-head">
          <span className={`live-dot ${live ? 'on' : ''}`}>{live ? 'Live' : 'Reconnecting…'}</span>
          <StatusBadge status={token.status} />
        </div>

        <p className="muted">Your token number</p>
        <div className="token-number">{token.token_number}</div>
        <p>
          <strong>{token.doctor.name}</strong> · {token.doctor.specialization} · Room {token.doctor.room}
        </p>
        <p className="muted small-text">
          {token.patient_name} · booked at {formatTime(token.created_at)}
        </p>

        {!token.is_today && <div className="alert">This token was for {token.token_date}.</div>}

        {waiting && token.is_today && (
          <div className="stats">
            <div>
              <span className="stat-value">{token.people_ahead}</span>
              <span className="stat-label">{token.people_ahead === 1 ? 'person' : 'people'} ahead</span>
            </div>
            <div>
              <span className="stat-value">{token.now_serving ?? '—'}</span>
              <span className="stat-label">Now serving</span>
            </div>
            <div>
              <span className="stat-value">{formatMinutes(token.estimated_wait_minutes)}</span>
              <span className="stat-label">Estimated wait</span>
            </div>
          </div>
        )}

        {MESSAGES[token.status] && <div className={`alert ${yourTurn ? 'success big' : ''}`}>{MESSAGES[token.status]}</div>}

        {waiting && token.people_ahead <= 2 && (
          <div className="alert success">Almost your turn — please be at the clinic.</div>
        )}

        {waiting && token.is_today && (
          <p className="muted small-text">
            Estimate based on {token.doctor.name.split(' ').slice(0, 2).join(' ')}’s average of{' '}
            {token.avg_consult_minutes} min per patient today.
          </p>
        )}

        {error && <div className="alert error">{error}</div>}

        <div className="row spread">
          <Link to="/" className="btn ghost">Book another</Link>
          {waiting && (
            <button className="btn danger ghost" onClick={cancel} disabled={cancelling}>
              Cancel token
            </button>
          )}
        </div>
      </div>
      <p className="muted center small-text">
        Tracking code: <strong>{token.code}</strong> — save this page link to come back later.
      </p>
    </div>
  )
}
