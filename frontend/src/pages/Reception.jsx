import { useEffect, useState } from 'react'
import { api } from '../api'
import QueuePanel from '../components/QueuePanel'

export default function Reception() {
  const [doctors, setDoctors] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/admin/doctors')
      .then((list) => {
        const active = list.filter((d) => d.is_active)
        setDoctors(active)
        if (active.length) setSelected(active[0].id)
      })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Reception</h1>
        <p className="muted">Issue walk-in tokens and call patients for each doctor.</p>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="tabs">
        {doctors.map((d) => (
          <button key={d.id} className={`tab ${selected === d.id ? 'active' : ''}`} onClick={() => setSelected(d.id)}>
            {d.name}
            <span className="muted"> · Room {d.room}</span>
          </button>
        ))}
      </div>
      {selected && <QueuePanel key={selected} doctorId={selected} allowWalkin allowCancel />}
      {!selected && !error && <p className="muted">No active doctors. Ask the admin to add one.</p>}
    </div>
  )
}
