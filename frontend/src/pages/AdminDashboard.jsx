import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import Analytics from '../components/Analytics'

const EMPTY_DOCTOR = { name: '', specialization: '', room: '', default_consult_minutes: 10 }
const EMPTY_USER = { name: '', username: '', password: '', role: 'receptionist', doctor_id: '' }

function DoctorsTab() {
  const [doctors, setDoctors] = useState([])
  const [form, setForm] = useState(EMPTY_DOCTOR)
  const [message, setMessage] = useState({ type: '', text: '' })

  const load = useCallback(() => api('/admin/doctors').then(setDoctors), [])
  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault()
    try {
      await api('/admin/doctors', { method: 'POST', body: form })
      setForm(EMPTY_DOCTOR)
      setMessage({ type: 'success', text: 'Doctor added.' })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  const patch = async (id, body) => {
    try {
      await api(`/admin/doctors/${id}`, { method: 'PATCH', body })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  return (
    <div className="grid two-one">
      <div className="card">
        <h3>Doctors</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Room</th><th>Default consult</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d.id} className={d.is_active ? '' : 'inactive'}>
                  <td>{d.name}<br /><span className="muted small-text">{d.specialization}</span></td>
                  <td>{d.room}</td>
                  <td>
                    <input
                      className="inline-input"
                      type="number"
                      min="1"
                      max="120"
                      defaultValue={d.default_consult_minutes}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (v !== d.default_consult_minutes) patch(d.id, { default_consult_minutes: v })
                      }}
                    /> min
                  </td>
                  <td>{d.is_active ? 'On duty' : 'Inactive'}</td>
                  <td>
                    <button className="btn small ghost" onClick={() => patch(d.id, { is_active: !d.is_active })}>
                      {d.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <h3>Add doctor</h3>
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr. …" required />
        <label>Specialization</label>
        <input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} placeholder="General Medicine" />
        <label>Room</label>
        <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="4" />
        <label>Default consultation time (minutes)</label>
        <input type="number" min="1" max="120" value={form.default_consult_minutes}
          onChange={(e) => setForm({ ...form, default_consult_minutes: e.target.value })} />
        {message.text && <div className={`alert ${message.type}`}>{message.text}</div>}
        <button className="btn full">Add doctor</button>
      </form>
    </div>
  )
}

function StaffTab() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [doctors, setDoctors] = useState([])
  const [form, setForm] = useState(EMPTY_USER)
  const [message, setMessage] = useState({ type: '', text: '' })

  const load = useCallback(() => {
    api('/admin/users').then(setUsers)
    api('/admin/doctors').then(setDoctors)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault()
    try {
      await api('/admin/users', {
        method: 'POST',
        body: { ...form, doctor_id: form.doctor_id ? Number(form.doctor_id) : null },
      })
      setForm(EMPTY_USER)
      setMessage({ type: 'success', text: 'Account created.' })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  const toggle = async (u) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  const resetPassword = async (u) => {
    const password = window.prompt(`New password for ${u.username} (min 6 characters):`)
    if (!password) return
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { password } })
      setMessage({ type: 'success', text: `Password changed for ${u.username}.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
  }

  return (
    <div className="grid two-one">
      <div className="card">
        <h3>Staff accounts</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
                  <td>{u.name}{u.doctor_name && <><br /><span className="muted small-text">{u.doctor_name}</span></>}</td>
                  <td>{u.username}</td>
                  <td><span className="tag">{u.role}</span></td>
                  <td>{u.is_active ? 'Active' : 'Disabled'}</td>
                  <td className="actions">
                    <button className="btn small ghost" onClick={() => resetPassword(u)}>Reset password</button>
                    {u.id !== me.id && (
                      <button className="btn small ghost" onClick={() => toggle(u)}>{u.is_active ? 'Disable' : 'Enable'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <h3>Add staff account</h3>
        <label>Full name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>Username</label>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        <label>Password</label>
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <label>Role</label>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="receptionist">Receptionist</option>
          <option value="doctor">Doctor</option>
          <option value="admin">Admin</option>
        </select>
        {form.role === 'doctor' && (
          <>
            <label>Linked doctor</label>
            <select value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })} required>
              <option value="">Choose…</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        )}
        {message.text && <div className={`alert ${message.type}`}>{message.text}</div>}
        <button className="btn full">Create account</button>
      </form>
    </div>
  )
}

const TABS = { analytics: 'Analytics', doctors: 'Doctors', staff: 'Staff' }

export default function AdminDashboard() {
  const [tab, setTab] = useState('analytics')
  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Admin</h1>
        <p className="muted">Clinic performance, doctors and staff accounts.</p>
      </div>
      <div className="tabs">
        {Object.entries(TABS).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'analytics' && <Analytics />}
      {tab === 'doctors' && <DoctorsTab />}
      {tab === 'staff' && <StaffTab />}
    </div>
  )
}
