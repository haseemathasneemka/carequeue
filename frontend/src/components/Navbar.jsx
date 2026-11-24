import { Link, NavLink, useNavigate } from 'react-router-dom'
import { HOME_FOR_ROLE, useAuth } from '../AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <span className="brand-mark">C</span>
        CareQueue
      </Link>
      <nav>
        <NavLink to="/" end>Book Token</NavLink>
        <NavLink to="/display" target="_blank">Display</NavLink>
        {user ? (
          <>
            {user.role === 'admin' && <NavLink to="/reception">Reception</NavLink>}
            <NavLink to={HOME_FOR_ROLE[user.role]}>Dashboard</NavLink>
            <span className="nav-user">{user.name} · {user.role}</span>
            <button className="btn small ghost" onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <NavLink to="/login">Staff Login</NavLink>
        )}
      </nav>
    </header>
  )
}
