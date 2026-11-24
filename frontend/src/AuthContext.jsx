import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, authStorage } from './api'

const AuthContext = createContext(null)

export const HOME_FOR_ROLE = {
  admin: '/admin',
  receptionist: '/reception',
  doctor: '/doctor',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(authStorage.get()))

  // On page load, check whether the saved login is still valid
  useEffect(() => {
    if (!authStorage.get()) return
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => authStorage.clear())
      .finally(() => setLoading(false))
  }, [])

  // api.js fires this when the server says the session expired
  useEffect(() => {
    const onLogout = () => setUser(null)
    window.addEventListener('cq:logout', onLogout)
    return () => window.removeEventListener('cq:logout', onLogout)
  }, [])

  const login = useCallback(async (username, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } })
    authStorage.set(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    authStorage.clear()
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
