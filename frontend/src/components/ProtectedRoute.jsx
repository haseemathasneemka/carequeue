import { Navigate, useLocation } from 'react-router-dom'
import { HOME_FOR_ROLE, useAuth } from '../AuthContext'

// Only lets logged-in staff (optionally with given roles) see the page.
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="container center muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_FOR_ROLE[user.role]} replace />
  return children
}
