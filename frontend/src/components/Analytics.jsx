import { useEffect, useState } from 'react'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { api } from '../api'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TEAL = '#0f766e'
const AMBER = '#d97706'
const RED = '#dc2626'

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true, grid: { color: '#eef2f2' } }, x: { grid: { display: false } } },
}

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })
const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`

export default function Analytics() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    api(`/admin/analytics?days=${days}`).then(setData).catch((e) => setError(e.message))
  }, [days])

  if (error) return <div className="alert error">{error}</div>
  if (!data) return <p className="muted">Loading analytics…</p>

  const { summary } = data
  // Only show clinic hours that actually had bookings (plus some padding)
  const busyHours = data.peak_hours.filter((h) => h.count > 0).map((h) => h.hour)
  const from = busyHours.length ? Math.max(0, Math.min(...busyHours) - 1) : 8
  const to = busyHours.length ? Math.min(23, Math.max(...busyHours) + 1) : 20
  const hours = data.peak_hours.filter((h) => h.hour >= from && h.hour <= to)
  const peak = data.peak_hours.reduce((a, b) => (b.count > a.count ? b : a), { count: 0 })

  return (
    <div className="stack">
      <div className="row spread">
        <p className="muted">
          {shortDate(data.start)} – {shortDate(data.end)}
        </p>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      <div className="grid stats-row">
        <div className="card stat"><span className="stat-value">{summary.total}</span><span className="stat-label">Tokens</span></div>
        <div className="card stat"><span className="stat-value">{summary.avg_wait_minutes ?? '—'} min</span><span className="stat-label">Avg wait</span></div>
        <div className="card stat"><span className="stat-value">{summary.avg_consult_minutes ?? '—'} min</span><span className="stat-label">Avg consultation</span></div>
        <div className="card stat"><span className="stat-value">{summary.no_show_rate}%</span><span className="stat-label">No-show rate</span></div>
        <div className="card stat">
          <span className="stat-value">{summary.total ? Math.round((summary.online * 100) / summary.total) : 0}%</span>
          <span className="stat-label">Booked online</span>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Peak hours</h3>
          <p className="muted small-text">
            {peak.count ? `Busiest: ${hourLabel(peak.hour)} – ${hourLabel((peak.hour + 1) % 24)}` : 'No bookings yet'}
          </p>
          <div className="chart">
            <Bar
              options={baseOptions}
              data={{
                labels: hours.map((h) => hourLabel(h.hour)),
                datasets: [{ label: 'Tokens booked', data: hours.map((h) => h.count), backgroundColor: TEAL, borderRadius: 4 }],
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3>Average wait time (minutes)</h3>
          <p className="muted small-text">From booking until the patient is called</p>
          <div className="chart">
            <Line
              options={baseOptions}
              data={{
                labels: data.daily.map((d) => shortDate(d.date)),
                datasets: [{
                  label: 'Avg wait (min)', data: data.daily.map((d) => d.avg_wait_minutes),
                  borderColor: AMBER, backgroundColor: AMBER, tension: 0.3, spanGaps: true,
                }],
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3>No-show rate (%)</h3>
          <p className="muted small-text">Patients who didn’t turn up when called</p>
          <div className="chart">
            <Bar
              options={baseOptions}
              data={{
                labels: data.daily.map((d) => shortDate(d.date)),
                datasets: [{ label: 'No-show %', data: data.daily.map((d) => d.no_show_rate), backgroundColor: RED, borderRadius: 4 }],
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3>Doctors</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Doctor</th><th>Tokens</th><th>Seen</th><th>No-show</th><th>Avg consult</th></tr>
              </thead>
              <tbody>
                {data.per_doctor.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}<br /><span className="muted small-text">{d.specialization}</span></td>
                    <td>{d.total}</td>
                    <td>{d.completed}</td>
                    <td>{d.no_show}</td>
                    <td>{d.avg_consult_minutes ? `${d.avg_consult_minutes} min` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
