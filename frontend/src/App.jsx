import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import { HOME_FOR_ROLE, useAuth } from './AuthContext'
import BookToken from './pages/BookToken'
import TokenStatus from './pages/TokenStatus'
import Display from './pages/Display'
import Login from './pages/Login'
import Reception from './pages/Reception'
import DoctorDashboard from './pages/DoctorDashboard'
import AdminDashboard from './pages/AdminDashboard'

function StaffHome() {
  const { user } = useAuth()
  return <Navigate to={HOME_FOR_ROLE[user.role]} replace />
}

function NotFound() {
  return (
    <div className="container narrow center">
      <h1>Page not found</h1>
      <Link to="/" className="btn">Go to booking</Link>
    </div>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const fullScreen = pathname === '/display' // the TV screen has no navbar

  return (
    <>
      {!fullScreen && <Navbar />}
      <main>
        <Routes>
          <Route path="/" element={<BookToken />} />
          <Route path="/token/:code" element={<TokenStatus />} />
          <Route path="/display" element={<Display />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/staff"
            element={<ProtectedRoute><StaffHome /></ProtectedRoute>}
          />
          <Route
            path="/reception"
            element={<ProtectedRoute roles={['receptionist', 'admin']}><Reception /></ProtectedRoute>}
          />
          <Route
            path="/doctor"
            element={<ProtectedRoute roles={['doctor']}><DoctorDashboard /></ProtectedRoute>}
          />
          <Route
            path="/admin"
            element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  )
}
