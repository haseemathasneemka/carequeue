import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useQueueRoom, useSocketStatus } from '../socket'

// Waiting-room TV screen. Open /display on a TV or monitor in full screen.
export default function Display() {
  const [board, setBoard] = useState([])
  const [clock, setClock] = useState(new Date())
  const [voice, setVoice] = useState(false)
  const [flash, setFlash] = useState(null)
  const previous = useRef({})
  const live = useSocketStatus()

  const announce = useCallback(
    (doctor, number) => {
      setFlash(doctor.id)
      setTimeout(() => setFlash(null), 6000)
      if (voice && 'speechSynthesis' in window) {
        const msg = new SpeechSynthesisUtterance(`Token number ${number}, please go to room ${doctor.room}.`)
        msg.rate = 0.9
        window.speechSynthesis.speak(msg)
      }
    },
    [voice],
  )

  const load = useCallback(() => {
    api('/display')
      .then((data) => {
        // Announce any doctor whose "now serving" number just changed to a new call
        data.forEach((row) => {
          const before = previous.current[row.doctor.id]
          if (before !== undefined && row.now_serving && row.now_serving !== before && row.now_serving_status === 'called') {
            announce(row.doctor, row.now_serving)
          }
          previous.current[row.doctor.id] = row.now_serving
        })
        setBoard(data)
      })
      .catch(() => {})
  }, [announce])

  useEffect(() => {
    load()
    const tick = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(tick)
  }, [load])

  useQueueRoom('display', load)

  return (
    <div className="display">
      <header className="display-head">
        <div className="brand light">
          <span className="brand-mark">C</span> CareQueue
        </div>
        <div className="display-clock">
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          <span className={`live-dot ${live ? 'on' : ''}`}>{live ? 'Live' : 'Offline'}</span>
        </div>
        <button className="btn small ghost light" onClick={() => setVoice(!voice)}>
          {voice ? '🔊 Voice on' : '🔇 Voice off'}
        </button>
      </header>

      <div className="display-grid">
        {board.length === 0 && <p className="display-empty">No doctors on duty.</p>}
        {board.map((row) => (
          <div key={row.doctor.id} className={`display-card ${flash === row.doctor.id ? 'flash' : ''}`}>
            <div className="display-doctor">
              <h2>{row.doctor.name}</h2>
              <span>{row.doctor.specialization} · Room {row.doctor.room}</span>
            </div>
            <div className="display-now">
              <span>Now serving</span>
              <strong>{row.now_serving ?? '—'}</strong>
            </div>
            <div className="display-next">
              <span>Next</span>
              <div>
                {row.next.length === 0 ? <em>No one waiting</em> : row.next.map((n) => <b key={n}>{n}</b>)}
              </div>
            </div>
            <div className="display-foot">{row.waiting_count} waiting · ~{Math.round(row.avg_consult_minutes)} min each</div>
          </div>
        ))}
      </div>
    </div>
  )
}
