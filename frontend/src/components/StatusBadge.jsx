const LABELS = {
  waiting: 'Waiting',
  called: 'Called',
  in_consultation: 'In consultation',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
}

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] || status}</span>
}

export function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatMinutes(min) {
  if (min === null || min === undefined) return '—'
  if (min < 1) return 'Less than a minute'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}
