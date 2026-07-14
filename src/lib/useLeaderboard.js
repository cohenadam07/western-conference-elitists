import { useCallback, useEffect, useRef, useState } from 'react'

// Shared Comp Chain daily-leaderboard data hook. Fetches today's board from the
// /api/leaderboard serverless function and can submit a score. Statuses:
// 'loading' | 'ready' | 'unconfigured' (store not connected) | 'error'.

export const dayKey = () => new Date().toLocaleDateString('en-CA')
export const dayLabel = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function useLeaderboard(auto = true) {
  const [state, setState] = useState({ status: 'idle', entries: [], count: 0 })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, status: s.entries.length ? 'ready' : 'loading' }))
    try {
      const r = await fetch(`/api/leaderboard?day=${dayKey()}`)
      const j = await r.json()
      if (j.configured === false) { setState({ status: 'unconfigured', entries: [], count: 0 }); return }
      setState({ status: 'ready', entries: j.entries || [], count: j.count || 0 })
    } catch { setState((s) => ({ ...s, status: 'error' })) }
  }, [])

  const submit = useCallback(async ({ name, moves, hints }) => {
    try {
      const r = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: dayKey(), name, moves, hints }),
      })
      const j = await r.json()
      if (j.configured === false) { setState({ status: 'unconfigured', entries: [], count: 0 }); return { rank: 0 } }
      setState({ status: 'ready', entries: j.entries || [], count: j.count || 0 })
      return { rank: j.rank || 0 }
    } catch { setState((s) => ({ ...s, status: 'error' })); return { rank: 0 } }
  }, [])

  useEffect(() => { if (auto) refresh() }, [auto, refresh])

  // Roll the board over at local midnight: when the puzzle's day changes, the
  // day key changes, so refetch to show the new (empty) day's board.
  const dayRef = useRef(dayKey())
  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => {
      const d = dayKey()
      if (d !== dayRef.current) { dayRef.current = d; refresh() }
    }, 30000)
    return () => clearInterval(id)
  }, [auto, refresh])

  return { ...state, refresh, submit }
}
