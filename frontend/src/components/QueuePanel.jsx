import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useQueueRoom } from '../socket'
import StatusBadge, { formatMinutes, formatTime } from './StatusBadge'

/**
 * Live queue for one doctor with the controls staff need.
 * Used by both the reception and the doctor dashboards.
 */
export default function QueuePanel({ doctorId, allowWalkin = false, allowCancel = false }) {
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [walkin, setWalkin] = useState({ patient_name: '', phone: '' })

  const load = useCallback(() => {
    api(`/staff/queue/${doctorId}`)
      .then((data) => {
        setQueue(data)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [doctorId])

  useEffect(() => {
    setQueue(null)
    load()
    const timer = setInterval(load, 60_000) // keep estimates fresh
    return () => clearInterval(timer)
  }, [load])

  // Another screen changed this doctor's queue -> refresh
  useQueueRoom('staff', (data) => {
    if (data.doctor_id === doctorId) load()
  })

  const run = async (path, successMessage) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(path, { method: 'POST' })
      if (successMessage) setNotice(successMessage(result))
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const addWalkin = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const t = await api(`/staff/queue/${doctorId}/walkin`, { method: 'POST', body: walkin })
      setNotice(`Walk-in token #${t.token_number} issued to ${walkin.patient_name}.`)
      setWalkin({ patient_name: '', phone: '' })
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!queue) return <div className="card muted">{error || 'Loading queue…'}</div>

  const { current, waiting, counts, doctor } = queue

  return (
    <div className="stack">
      <div className="grid stats-row">
        <div className="card stat"><span className="stat-value">{waiting.length}</span><span className="stat-label">Waiting</span></div>
        <div className="card stat"><span className="stat-value">{counts.completed || 0}</span><span className="stat-label">Seen today</span></div>
        <div className="card stat"><span className="stat-value">{counts.no_show || 0}</span><span className="stat-label">No-shows</span></div>
        <div className="card stat">
          <span className="stat-value">{queue.avg_consult_minutes} min</span>
          <span className="stat-label">
            Avg consult {queue.samples_today ? `(${queue.samples_today} today)` : '(default)'}
          </span>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="grid two">
        <div className="card now-serving">
          <h3>Now serving · Room {doctor.room}</h3>
          {current ? (
            <>
              <div className="token-number small">{current.token_number}</div>
              <p><strong>{current.patient_name}</strong> · {current.phone}</p>
              <p className="muted small-text">
                <StatusBadge status={current.status} /> called at {formatTime(current.called_at)}
                {current.started_at && <> · started {formatTime(current.started_at)}</>}
              </p>
              <div className="row wrap">
                {current.status === 'called' && (
                  <button className="btn" disabled={busy} onClick={() => run(`/staff/tokens/${current.id}/start`)}>
                    Start consultation
                  </button>
                )}
                <button
                  className="btn success"
                  disabled={busy}
                  onClick={() => run(`/staff/tokens/${current.id}/complete`, () => `Token #${current.token_number} completed.`)}
                >
                  Complete
                </button>
                {current.status === 'called' && (
                  <button
                    className="btn danger ghost"
                    disabled={busy}
                    onClick={() => run(`/staff/tokens/${current.id}/no-show`, () => `Token #${current.token_number} marked no-show.`)}
                  >
                    No-show
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muted">No one is with the doctor.</p>
              <button
                className="btn big"
                disabled={busy || waiting.length === 0}
                onClick={() => run(`/staff/queue/${doctorId}/call-next`, (r) => `Called token #${r.called.token_number}.`)}
              >
                {waiting.length ? `Call next (#${waiting[0].token_number})` : 'Queue is empty'}
              </button>
            </>
          )}
        </div>

        {allowWalkin ? (
          <form className="card" onSubmit={addWalkin}>
            <h3>Add walk-in patient</h3>
            <label htmlFor="w-name">Name</label>
            <input id="w-name" value={walkin.patient_name} onChange={(e) => setWalkin({ ...walkin, patient_name: e.target.value })} required />
            <label htmlFor="w-phone">Mobile</label>
            <input id="w-phone" value={walkin.phone} inputMode="numeric" onChange={(e) => setWalkin({ ...walkin, phone: e.target.value })} required />
            <button className="btn full" disabled={busy}>Issue token</button>
          </form>
        ) : (
          <div className="card">
            <h3>Up next</h3>
            {waiting.slice(0, 3).map((t) => (
              <p key={t.id}><strong>#{t.token_number}</strong> {t.patient_name}</p>
            ))}
            {waiting.length === 0 && <p className="muted">No one waiting.</p>}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Waiting list</h3>
        {waiting.length === 0 ? (
          <p className="muted">No patients waiting.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th><th>Patient</th><th>Phone</th><th>Type</th><th>Booked</th><th>Est. wait</th><th></th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((t) => (
                  <tr key={t.id}>
                    <td><strong>#{t.token_number}</strong></td>
                    <td>{t.patient_name}</td>
                    <td>{t.phone}</td>
                    <td><span className={`tag ${t.source}`}>{t.source === 'online' ? 'Online' : 'Walk-in'}</span></td>
                    <td>{formatTime(t.created_at)}</td>
                    <td>{formatMinutes(t.estimated_wait_minutes)}</td>
                    <td className="actions">
                      <button className="btn small ghost" disabled={busy} onClick={() => run(`/staff/tokens/${t.id}/no-show`)}>
                        No-show
                      </button>
                      {allowCancel && (
                        <button className="btn small ghost danger" disabled={busy} onClick={() => run(`/staff/tokens/${t.id}/cancel`)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
