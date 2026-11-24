// The WCE Control Room page's data shapes (copied from the /wce mod's contract): what wcehoops.com/api/status last answered, and what the
// panel is showing. Every value here is JSON the feed sent, or the panel's own choices.

export type JobStatus = 'ok' | 'running' | 'failed' | 'late' | 'stalled' | 'waiting' | 'manual' | 'cancelled'

export type Job = {
  id: string
  name: string
  lane: string
  product: string
  cadence: string
  workflow: string | null
  next: number | null
  maxAgeH: number | null
  last: { state: string; t: number; detail: string | null; run: string | null; dur: number | null } | null
  since: number | null
  lastOk: number | null
  lastFail: number | null
  failDetail: string | null
  failRun: string | null
  streak: number
  backfilled: boolean
  status: JobStatus
  // Muse's jobs only: its last good post, and when its last numbers came in.
  lastPost?: { t: number; url: string } | null
  lastSnap?: number | null
}

export type FeedEvent = { t: number; job: string; state: string; detail?: string; run?: string; dur?: number; source?: string; kind?: 'post' | 'snapshot'; url?: string }

export type Deploy = {
  id: string
  state: string
  target: string
  created: number | null
  building: number | null
  ready: number | null
  message: string | null
  author: string | null
  sha: string | null
  inspect: string | null
}

export type Feed = {
  now: number
  jobs: Job[]
  events: FeedEvent[]
  upcoming: { job: string; t: number }[]
  deploys: { list?: Deploy[]; error?: string }
  counts: Record<string, number>
}

export type Reach = {
  now: number
  visits: { today?: { visitors: number; pageviews: number }; week?: { date: string; visitors: number; pageviews: number }[]; error?: string }
  connector: { today?: number; errorsToday?: number; connectionsToday?: number; week?: { date: string; calls: number }[]; error?: string }
  keys: { founding?: number; error?: string }
  dynasty: { ballots?: number; dailyToday?: number; error?: string }
  newsletter: { subscribers?: number; error?: string }
  youtube: { connected: boolean }
  social: { connected: boolean; platforms?: Record<string, SocialPlatform>; error?: string }
  search: { connected: boolean }
}

// One platform's latest numbers from Muse (api/_status.js readSocial). `change7` is the change
// since `since` (about a week ago); `followers` is one point a day for the last 90 days.
export type SocialPlatform = {
  t: number
  metrics: Partial<Record<'followers' | 'reach_24h' | 'views_24h' | 'engagement_24h' | 'posts_24h' | 'profile_visits_24h' | 'likes_24h' | 'comments_24h' | 'shares_24h', number | null>>
  change7: Record<string, number>
  since: string | null
  followers: { d: string; n: number | null }[]
}

// One light traveling a wire, for one real event. `at` is when it set off (ms); `lane` is the
// route it takes on the map; `n` how many it stands for (visits come in batches).
export type Pulse = { id: string; at: number; lane: string; color: string; n?: number; burst?: boolean }

export type Tab = 'map' | 'list' | 'timeline' | 'll'

// Live Lineups usage (api/_ll-usage.js readLlUsage, /api/status?part=ll)
export type LlCount = { name: string; n: number }
export type LlEvent = { t: number; k: string; [f: string]: string | number | undefined }
export type LlSession = { id: string; first: number; last: number; openMin: number; team?: string; mode?: string; dev?: string; minutes: Record<string, number>; events: LlEvent[] }
export type LlUsage = {
  now: number
  days: { day: string; events: number; sessions: number; opens: number }[]
  totals: { tabs: LlCount[]; picks: LlCount[]; downloads: LlCount[]; drawer: number; segments: LlCount[]; halftime: number; banners: LlCount[]; devices: LlCount[] }
  sessions: LlSession[]
}
