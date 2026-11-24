// Small wrapper around fetch for talking to the Flask API.
// In development Vite proxies /api to Flask, so the base URL is empty.
const BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'cq_auth_token'

export const authStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = authStorage.get()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0)
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty response */
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      authStorage.clear()
      window.dispatchEvent(new Event('cq:logout'))
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data)
  }
  return data
}

// Remember tokens a patient booked on this phone, so they can reopen them
const MY_TOKENS_KEY = 'cq_my_tokens'

export const myTokens = {
  list() {
    try {
      return JSON.parse(localStorage.getItem(MY_TOKENS_KEY)) || []
    } catch {
      return []
    }
  },
  add(entry) {
    const today = new Date().toISOString().slice(0, 10)
    const list = myTokens.list().filter((t) => t.code !== entry.code && t.date === today)
    localStorage.setItem(MY_TOKENS_KEY, JSON.stringify([{ ...entry, date: today }, ...list].slice(0, 5)))
  },
}
