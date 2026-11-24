import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

// One shared Socket.IO connection for the whole app.
// With no URL it connects to the same host the page came from (Vite proxies it in dev).
export const socket = io(import.meta.env.VITE_API_URL || undefined, {
  transports: ['websocket', 'polling'],
})

/**
 * Join a Socket.IO room and call `onUpdate` whenever the server
 * sends `queue_update` ({ doctor_id }) to that room.
 * Re-joins automatically after a reconnect.
 */
export function useQueueRoom(room, onUpdate) {
  const handlerRef = useRef(onUpdate)
  handlerRef.current = onUpdate

  useEffect(() => {
    if (!room) return undefined
    const join = () => socket.emit('join', { room })
    const handle = (data) => handlerRef.current?.(data)

    if (socket.connected) join()
    socket.on('connect', join)
    socket.on('queue_update', handle)

    return () => {
      socket.emit('leave', { room })
      socket.off('connect', join)
      socket.off('queue_update', handle)
    }
  }, [room])
}

/** true while the live connection is up (shown as a small "Live" dot). */
export function useSocketStatus() {
  const [connected, setConnected] = useState(socket.connected)
  useEffect(() => {
    const on = () => setConnected(true)
    const off = () => setConnected(false)
    socket.on('connect', on)
    socket.on('disconnect', off)
    return () => {
      socket.off('connect', on)
      socket.off('disconnect', off)
    }
  }, [])
  return connected
}
