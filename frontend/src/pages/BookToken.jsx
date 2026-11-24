import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, myTokens } from '../api'
import { useQueueRoom } from '../socket'
import { formatMinutes } from '../components/StatusBadge'

export default function BookToken() {
  const navigate = useNavigate()
  const [doctors, setDoctors] = useState([])
  const [form, setForm] = useState({ doctor_id: '', patient_name: '', phone: '' })
  const [error, setError] = useState('')
  const [existingCode, setExistingCode] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [trackCode, setTrackCode] = useState('')
  const saved = myTokens.list()

  const loadDoctors = useCallback(() => {
    api('/doctors').then(setDoctors).catch((e) => setError(e.message))
  }, [])

  useEffect(loadDoctors, [loadDoctors])
  // Keep the waiting counts on the doctor cards live
  useQueueRoom('display', loadDoctors)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setExistingCode(null)
    if (!form.doctor_id) return setError('Please choose a doctor.')
    setSubmitting(true)
    try {
      const token = await api('/tokens', {
        method: 'POST',
        body: { ...form, doctor_id: Number(form.doctor_id) },
      })
      const doctor = doctors.find((d) => d.id === Number(form.doctor_id))
      myTokens.add({ code: token.code, number: token.token_number, doctor: doctor?.name })
      navigate(`/token/${token.code}`)
    } catch (err) {
      setError(err.message)
      if (err.data?.code) setExistingCode(err.data.code)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <section className="hero">
        <h1>Skip the waiting room.</h1>
        <p>Book your OP token online and watch your place in the queue live from your phone.</p>
      </section>

      <div className="grid two">
        <form className="card" onSubmit={submit}>
          <h2>Book a token</h2>

          <label>Choose doctor</label>
          <div className="doctor-options">
            {doctors.length === 0 && <p className="muted">No doctors available right now.</p>}
            {doctors.map((d) => (
              <label key={d.id} className={`doctor-option ${String(d.id) === form.doctor_id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="doctor"
                  value={d.id}
                  checked={String(d.id) === form.doctor_id}
                  onChange={update('doctor_id')}
                />
                <div>
                  <strong>{d.name}</strong>
                  <span className="muted">{d.specialization} · Room {d.room}</span>
                </div>
                <div className="doctor-load">
                  <strong>{d.waiting}</strong> waiting
                  <span className="muted">~{formatMinutes(d.estimated_wait_minutes)}</span>
                </div>
              </label>
            ))}
          </div>

          <label htmlFor="name">Patient name</label>
          <input id="name" value={form.patient_name} onChange={update('patient_name')} placeholder="Full name" required />

          <label htmlFor="phone">Mobile number</label>
          <input
            id="phone"
            value={form.phone}
            onChange={update('phone')}
            placeholder="10-digit mobile number"
            inputMode="numeric"
            required
          />

          {error && (
            <div className="alert error">
              {error}{' '}
              {existingCode && <Link to={`/token/${existingCode}`}>View that token →</Link>}
            </div>
          )}

          <button className="btn full" disabled={submitting}>
            {submitting ? 'Booking…' : 'Get my token'}
          </button>
        </form>

        <div className="stack">
          <div className="card">
            <h2>Already have a token?</h2>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                if (trackCode.trim()) navigate(`/token/${trackCode.trim()}`)
              }}
            >
              <input value={trackCode} onChange={(e) => setTrackCode(e.target.value)} placeholder="Tracking code" />
              <button className="btn secondary">Track</button>
            </form>
            {saved.length > 0 && (
              <>
                <p className="muted small-text">Booked on this device today</p>
                <ul className="saved-tokens">
                  {saved.map((t) => (
                    <li key={t.code}>
                      <Link to={`/token/${t.code}`}>
                        Token #{t.number} · {t.doctor}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="card how">
            <h2>How it works</h2>
            <ol>
              <li>Pick your doctor and book a token.</li>
              <li>Keep the tracking page open. It updates by itself.</li>
              <li>Reach the clinic when only a few patients are ahead of you.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
