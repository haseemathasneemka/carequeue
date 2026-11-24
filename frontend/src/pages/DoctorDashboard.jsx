import { useAuth } from '../AuthContext'
import QueuePanel from '../components/QueuePanel'

export default function DoctorDashboard() {
  const { user } = useAuth()

  if (!user.doctor_id) {
    return (
      <div className="container narrow">
        <div className="alert error">This login is not linked to a doctor. Ask the admin to fix it.</div>
      </div>
    )
  }

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>My queue</h1>
        <p className="muted">Call patients, start and finish consultations. Everything updates live.</p>
      </div>
      <QueuePanel doctorId={user.doctor_id} />
    </div>
  )
}
