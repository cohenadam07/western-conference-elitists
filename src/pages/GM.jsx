import { Component, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import usePageMeta from '../lib/usePageMeta.js'
import './gm.css'

import { SEED } from '../lib/gm/seed.js'
import {
  CBA, money as fmt, teamSalary, status, statusLabel, APRON_CONSEQUENCE,
  validateTrade, maxIncoming,
} from '../lib/gm/cap.js'
import { CLUB, CITY, themeVars, initials, clubInk } from '../lib/gm/theme.js'
import Shell, { SCREENS } from '../components/gm/Shell.jsx'
import GameCast from '../components/gm/GameCast.jsx'
import Celebration from '../components/gm/Celebration.jsx'
import { Card, Tip, Ring, Donut, Arena, money, short, useCountUp } from '../components/gm/ui.jsx'
import Avatar, {
  DEFAULT_GM, randomGM, SKIN, HAIR_COLOR, SUIT, SHIRT, TIE, HAIR_STYLES, FACIAL, GLASSES,
} from '../lib/gm/avatar.jsx'
import {
  newCareer, loadCareer, saveCareer, saveAndSync, fetchBoards,
  franchises, activeSlot, leaveCareer, deleteFranchise, MAX_FRANCHISES,
} from '../lib/gm/storage.js'
import { rostersOf, allRosters, rosterOf as leagueRosterOf, setLeague } from '../lib/gm/league.js'
import { newSeason, playNext, standings, teamGames, TEAMS } from '../lib/gm/season.js'
import {
  runPlayoffs, teamRun, openBracket, stepBracket, playRound, playThisSeries,
  bracketResult, roundSeries, roundName, ROUNDS,
} from '../lib/gm/playoffs.js'
import {
  rollSeason, runContracts, ageRoster, refill, rookieContract, reSign, labelRookie, BADGES,
  applyPractice, developmentReport,
} from '../lib/gm/offseason.js'
import { runLottery, generateClass, scout, scoutWithStaff, runDraft } from '../lib/gm/draft.js'
import { openFreeAgency, resolveFreeAgency, askingPrice, maxOffer } from '../lib/gm/leagueYear.js'
import { enrich, scoutedProfile, report as scoutReport, gradeOf, SKILL_LABEL } from '../lib/gm/prospects.js'
import { makeScoutMarket, describeScout, coverage, payroll, accuracyFor,
  REGIONS, REGION, SCOUT_BUDGET } from '../lib/gm/scouts.js'
import { marketPrice, makePersonality, Negotiation, rivalOffers, appealOf } from '../lib/gm/fa.js'
import {
  poolOf, rosterCheck, exceptionsFor, canSign, askingPrice as poolAsk, signFromPool, waiveToPool,
  maxSigning, cpuFillFromPool, MIN_SALARY, MIN_ROSTER,
} from '../lib/gm/pool.js'
import { rng } from '../lib/gm/sim.js'
import {
  newPickLedger, pickKey, pickValue, label as pickLabel, violatesStepien, strengthRanks,
  rebuildLedger, ownedBy, describePick, conveyanceOdds, REAL_PICKS_SOURCE,
} from '../lib/gm/picks.js'
import { generateOffers, offerMargin, DEADLINE_GAME } from '../lib/gm/deadline.js'
import { applyTrade } from '../lib/gm/trades.js'
import { seasonReport } from '../lib/gm/report.js'
import { playerMarketValue, talentVorp, TIERS } from '../lib/gm/trade/market.js'
import { teamContext } from '../lib/gm/trade/context.js'
import { decideTrade, availabilityOf, verdictText, VERDICT, AVAILABILITY } from '../lib/gm/trade/accept.js'
import { makeItWork, shopPackage } from '../lib/gm/trade/negotiate.js'
import { runMarket, offersForUser, describeFO } from '../lib/gm/trade/agents.js'
import { vote as voteAwards, yours as awardsYours } from '../lib/gm/awards.js'
import { issueMandate, gradeSecondary } from '../lib/gm/mandate.js'
// `roundName` and `ROUNDS` are both taken by playoffs.js — the postseason has rounds too, and
// they mean something different. Aliased rather than renamed at the source, because the Cup's
// own module reads better with the plain names.
import { groupTable, qualifiers, openKnockout, raiseBanner,
  roundName as cupRoundName, ROUNDS as CUP_ROUNDS_META,
  CUP_BOOST, DEFERRED_BOOST, CUP_NAME } from '../lib/gm/cup.js'
import { cupGroupDone, playCupRound, currentDay } from '../lib/gm/season.js'
import { today as calToday, ahead as calAhead, whenText, label as dateLabel,
  DAY_NAME, weekday } from '../lib/gm/calendar.js'
import { weekend as asWeekend, playGame as asPlayGame, makeRate, judge,
  DUNKS, RACKS, BALLS, MAX_THREE, ALLSTAR_GAME, needFor } from '../lib/gm/allstar.js'
import { SITUATION, LABEL as SIT_LABEL, CHECKPOINTS as SIT_CHECKPOINTS, sweep as sweepStories,
  clearSeason as clearStories, setSituations, situationOf, wireLine, heatOf,
  talkdownChance, REFUSAL_PENALTY } from '../lib/gm/story.js'
import { STANCES, STANCE_LABEL, STANCE_BLURB, readStance } from '../lib/gm/trade/stance.js'
import { applyLeagueTrade, refillLeague, coolDown } from '../lib/gm/trades.js'
import {
  PHASES, phaseOf, nextPhase, objectives, allowed, canAdvance, chapterOf,
  coachingFor, isFirstCareerYear, visited, markVisited, runStep,
} from '../lib/gm/phase.js'
import { MODES, MODE, modeOf, controls, handledBy } from '../lib/gm/modes.js'
import { LESSON, nextLesson, learn, glossary } from '../lib/gm/lessons.js'
import { badgesFor, tendenciesFor, BADGES as BADGE_LIST, TIERS as BADGE_TIERS } from '../lib/gm/badges.js'
import { TEAM_MINUTES, MAX_MINUTES, sustainable, strain, autoRotation, checkRotation,
  applyRotation, accumulateWear, availabilityNow, applyWear, applySulk, wornDown,
  rotationOrder, rebalance, rotationAdvice } from '../lib/gm/rotation.js'
import { bandOf, ratePerMin } from '../lib/gm/trade/context.js'
import { advisor, NEED_WEIGHT_FLOOR } from '../lib/gm/advisor.js'
import { savantProfile, findPlayer } from '../lib/gm/savant.js'

/* ------------------------------------------------------------------ helpers */

// A player's "overall" is his production percentile against the league — never a
// hand-typed number.
//
// It used to be built from VORP, and VORP is CUMULATIVE: it counts minutes as well as
// quality, so a star who missed most of a season came out looking like a bench player.
// Jayson Tatum posted a 4.8 box plus/minus — top-decile production — and rated 68,
// because he was available for 20% of the season. The rating now reads a RATE, and
// availability is reported next to it as its own fact rather than hidden inside it.
// Box plus/minus, laid onto the 50-99 scale a rating is read on. The anchors are the
// league's own landmarks — a replacement body, an average rotation player, a starter, an
// All-Star, an All-NBA season, an MVP — and everything between them is interpolated. A
// straight percentile was tried first and squashed the top: it cannot tell a 4-BPM
// rotation big from an 11-BPM MVP, because at that end of the league one point of BPM is
// most of a tier.
const OVR_ANCHORS = [[-6, 55], [-3, 65], [0, 74], [2, 80], [5, 88], [8, 93], [12, 98], [16, 99]]

function ovrOf(p) {
  const b = typeof p.bpm === 'number' ? p.bpm : null
  if (b === null) return null
  let out = OVR_ANCHORS[0][1]
  for (let i = 1; i < OVR_ANCHORS.length; i++) {
    const [x0, y0] = OVR_ANCHORS[i - 1], [x1, y1] = OVR_ANCHORS[i]
    if (b <= x1) { out = y0 + ((b - x0) / (x1 - x0)) * (y1 - y0); break }
    out = y1
  }
  return Math.max(50, Math.min(99, Math.round(out)))
}

const OVR_TIP = 'Overall is a RATE, not a total: box plus/minus — points of impact per 100 ' +
  'possessions — laid onto a 50-99 scale against the league’s own landmarks. It used to be built ' +
  'from VORP, which counts minutes as well as quality, so a star who missed a season rated like a ' +
  'bench player. Availability is now reported next to it instead of hidden inside it.'

// Availability is a fact about last season, not a rating. It is worth flagging because it
// is the single thing most likely to make a good contract a bad one.
const availTag = (p) => (typeof p.av === 'number' && p.av < 62
  ? { label: `${Math.round(p.av)}% avail`,
      tip: `Played ${Math.round(p.av)}% of what was available to him last season. He is drawn ` +
        `for before every game at about that rate — when he plays he plays his minutes, and ` +
        `the nights he does not, the rest of the roster absorbs them.` }
  : null)

// The user's roster comes out of the league, which is the only copy there is.
function rosterOf(save) {
  return leagueRosterOf(save) || []
}

function teamRating(roster) {
  const rated = roster.map((p) => ({ ...p, ovr: ovrOf(p) })).filter((p) => p.ovr)
    .sort((a, b) => b.ovr - a.ovr)
  const top = rated.slice(0, 9)
  const avg = (k) => top.length
    ? Math.round(top.reduce((s, p) => s + (p[k] ?? 50), 0) / top.length) : 50
  return { rated, ovr: avg('ovr'), off: avg('sc') ? Math.round(50 + (avg('sc') / 2)) : avg('ovr'),
    def: avg('pd') ? Math.round(50 + (avg('pd') / 2)) : avg('ovr') }
}

/* ------------------------------------------------------------------ hiring */

function Swatches({ label, colors, value, onChange }) {
  return (
    <div>
      <div className="fo-k" style={{ marginBottom: 7 }}>{label}</div>
      <div className="fo-swatches">
        {colors.map((c, i) => (
          <button key={c + i} type="button" className="fo-sw" aria-label={`${label} ${i + 1}`}
            aria-pressed={value === i} onClick={() => onChange(i)} style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}

function Opts({ label, options, value, onChange }) {
  return (
    <div>
      <div className="fo-k" style={{ marginBottom: 7 }}>{label}</div>
      <div className="fo-opts">
        {options.map((o, i) => (
          <button key={o} type="button" className="fo-opt" aria-pressed={value === i}
            onClick={() => onChange(i)}>{o}</button>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- franchises */

// The cabinet. Three files, because a career you cannot leave is a career you can only
// play once — and the question that makes this genre interesting ("what if I had blown it
// up instead?") needs a second file to answer.
function FranchiseMenu({ slots, onOpen, onNew, onDelete }) {
  const [confirm, setConfirm] = useState(null)
  const used = slots.filter((s) => s.summary).length
  return (
    <div className="fo-setup">
      <div className="fo-k">Front Office · {SEED.season}</div>
      <h2 style={{ font: '700 clamp(30px,5vw,46px)/1.02 "Barlow Semi Condensed",sans-serif',
        letterSpacing: '.04em', textTransform: 'uppercase', margin: '12px 0 0' }}>
        Your franchises
      </h2>
      {/* THE FIRST SENTENCE ANYBODY READS.
          This screen used to open straight onto "you can keep three careers at once" — house-
          keeping about save files, addressed to somebody who does not yet know what a career
          IS here. A person arriving cold learned nothing about the game before being asked to
          start one. Say what the job is first; the filing cabinet can wait a paragraph. */}
      <p className="fo-lede">
        Take the job at one of the thirty clubs and run it: the roster, the trades, the money,
        the draft. Every contract, cap rule and rating is real, and every game is played out
        possession by possession — nothing here is scripted.
      </p>
      <p className="fo-muted" style={{ maxWidth: '62ch', marginTop: 10, fontSize: 13.5 }}>
        You can keep {MAX_FRANCHISES} careers at once — {used} in use. Each one has its own
        league, its own thirty rosters and its own record book, and none of them touches
        the others.
      </p>

      <div className="fo-slots">
        {slots.map(({ slot, summary: f }) => {
          if (!f) {
            return (
              <button key={slot} type="button" className="fo-slot empty" onClick={() => onNew(slot)}>
                <span className="no">{String(slot).padStart(2, '0')}</span>
                <b>Empty file</b>
                <span className="bl">Take a job with any of the thirty clubs.</span>
                <span className="fo-btn sm" style={{ marginTop: 'auto' }}>Start a franchise</span>
              </button>
            )
          }
          const [c1] = CLUB[f.team] || ['#00A2E8']
          const [city, nm] = CITY[f.team] || [f.team, '']
          const ph = PHASES.find((p) => p.key === f.phase)
          return (
            <div key={slot} className="fo-slot" style={{ '--pc': c1 }}>
              <span className="no">{String(slot).padStart(2, '0')}</span>
              <div className="top">
                <span className="crest" style={{ background: c1, color: clubInk(f.team) }}>{f.team}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="cty">{city}</span>
                  <span className="tn">{nm}</span>
                </span>
              </div>
              <div className="who">
                <Avatar gm={f.avatar || {}} size={28} />
                <span>
                  <b>{f.gm}</b>
                  <span className="fo-faint" style={{ fontSize: 11 }}>
                    {f.employed ? 'General manager' : 'Dismissed'}
                    {' · '}{SEED.presets[f.mode]?.label || 'Custom'}
                  </span>
                </span>
              </div>
              <div className="stat">
                <div><span className="fo-k">Season</span><b>{f.season}</b></div>
                <div><span className="fo-k">Record</span><b>{f.seasons ? `${f.wins}–${f.losses}` : '—'}</b></div>
                <div><span className="fo-k">Titles</span><b>{f.titles}</b></div>
              </div>
              <div className="fo-faint" style={{ fontSize: 11.5, marginTop: 8 }}>
                {f.seasons === 0 ? 'Year one' : `${f.seasons} season${f.seasons === 1 ? '' : 's'} in`}
                {ph ? ` · ${ph.name}` : ''}
              </div>
              {confirm === slot ? (
                <div className="fo-verdict no" style={{ marginTop: 'auto' }}>
                  <div className="h fo-faint">Delete this franchise</div>
                  <div className="d">The roster, the picks, the banners — all of it, permanently.</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="fo-btn danger sm"
                      onClick={() => { onDelete(slot); setConfirm(null) }}>Delete for good</button>
                    <button type="button" className="fo-btn ghost sm" onClick={() => setConfirm(null)}>Keep it</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button type="button" className="fo-btn sm" onClick={() => onOpen(slot)}>Continue</button>
                  <button type="button" className="fo-btn ghost sm" onClick={() => setConfirm(slot)}>Delete</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Leaving is two different decisions and the game should never guess which one you meant.
function QuitDialog({ save, onSave, onDelete, onCancel }) {
  const [sure, setSure] = useState(false)
  const [city, nm] = CITY[save.franchise.team] || [save.franchise.team, '']
  const r = save.records
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  const done = [
    r.seasonsCompleted ? plural(r.seasonsCompleted, 'season') : null,
    r.tradesMade ? plural(r.tradesMade, 'trade') : null,
    r.championships ? plural(r.championships, 'title') : null,
  ].filter(Boolean)
  return (
    <div className="fo-cast" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="fo-cast-in" style={{ width: 'min(520px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 20px' }}>
          <div className="fo-k">Leave the {city} {nm}</div>
          <h3 style={{ font: '700 24px/1.1 "Barlow Semi Condensed",sans-serif', letterSpacing: '.04em',
            textTransform: 'uppercase', margin: '9px 0 0' }}>Quit to your franchises</h3>
          <p className="fo-muted" style={{ fontSize: 13.5, marginTop: 9 }}>
            {done.length
              ? `Everything is already written to this file — ${done.join(', ')}. You can come back to it whenever you like.`
              : 'Nothing has happened here yet, but the file is yours. You can come back to it whenever you like.'}
          </p>
          <div style={{ display: 'grid', gap: 9, marginTop: 16 }}>
            <button type="button" className="fo-btn" onClick={onSave}>Save and quit</button>
            <button type="button" className="fo-btn ghost" onClick={onCancel}>Stay in the job</button>
          </div>
          <div className="fo-verdict no" style={{ marginTop: 16 }}>
            <div className="h fo-faint">Or end it here</div>
            <div className="d">Quitting and deleting frees the file for a different franchise. There is no undo.</div>
            {sure ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="fo-btn danger sm" onClick={onDelete}>Yes, delete this career</button>
                <button type="button" className="fo-btn ghost sm" onClick={() => setSure(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="fo-btn ghost sm" style={{ marginTop: 10 }}
                onClick={() => setSure(true)}>Quit and delete</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Hiring({ onHire, onCancel, slot }) {
  const [step, setStep] = useState(0)
  const [gm, setGm] = useState(DEFAULT_GM)
  const [team, setTeam] = useState('OKC')
  const [preset, setPreset] = useState('guided')
  const [levels, setLevels] = useState(() => ({ ...SEED.presets.guided.levels }))
  const [realPicks, setRealPicks] = useState(true)
  const set = (k) => (v) => setGm({ ...gm, [k]: v })

  const rows = useMemo(() => Object.keys(SEED.teams).map((t) => {
    const tot = teamSalary(rostersOf(t))
    const st = status(tot)
    return { t, tot, label: statusLabel(st), space: st.space, conf: SEED.teams[t].conf }
  }).sort((a, b) => a.t.localeCompare(b.t)), [])

  useEffect(() => {
    const v = themeVars(team)
    const el = document.querySelector('.fo')
    if (el) Object.entries(v).forEach(([k, val]) => el.style.setProperty(k, val))
  }, [team])

  const canGo = step === 0 ? gm.name.trim().length > 0 : true
  const STEPS = ['Your GM', 'Your franchise', 'Your job']

  return (
    <div className="fo-setup">
      <div className="fo-k">Front Office · {SEED.season}{slot ? ` · file ${String(slot).padStart(2, '0')}` : ''}</div>
      <h2 style={{ font: '700 clamp(30px,5vw,46px)/1.02 "Barlow Semi Condensed",sans-serif',
        letterSpacing: '.04em', textTransform: 'uppercase', margin: '12px 0 0' }}>
        You have been hired.
      </h2>
      <p className="fo-muted" style={{ maxWidth: '62ch', marginTop: 10, fontSize: 14.5 }}>
        Every contract in this game is real, every cap rule is the 2023 CBA, and every rating
        comes from 53 metrics across 47 seasons. Three questions before you start.
      </p>
      <ol className="fo-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : ''}>
            <i>{String(i + 1).padStart(2, '0')}</i>{s}
          </li>
        ))}
      </ol>

      <div style={{ marginTop: 26 }}>
        {step === 0 && (
          <div className="fo-hire" style={{ display: 'grid', gap: 26,
            gridTemplateColumns: 'minmax(0,240px) minmax(0,1fr)' }}>
            <div style={{ display: 'grid', gap: 14, justifyItems: 'center', alignContent: 'start' }}>
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 8, padding: 12, lineHeight: 0 }}>
                <Avatar gm={gm} size={196} />
              </div>
              <button type="button" className="fo-btn ghost sm"
                onClick={() => setGm({ ...randomGM(), name: gm.name })}>Surprise me</button>
            </div>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <div className="fo-k" style={{ marginBottom: 7 }}>Your name</div>
                <input className="fo-input" value={gm.name} placeholder="Adam Cohen"
                  onChange={(e) => setGm({ ...gm, name: e.target.value.slice(0, 28) })} />
              </div>
              <Swatches label="Skin" colors={SKIN} value={gm.skin} onChange={set('skin')} />
              <Swatches label="Hair colour" colors={HAIR_COLOR} value={gm.hairColor} onChange={set('hairColor')} />
              <Opts label="Hair" options={HAIR_STYLES} value={gm.hair} onChange={set('hair')} />
              <Opts label="Facial hair" options={FACIAL} value={gm.facial} onChange={set('facial')} />
              <Opts label="Glasses" options={GLASSES} value={gm.glasses} onChange={set('glasses')} />
              <Swatches label="Suit" colors={SUIT} value={gm.suit} onChange={set('suit')} />
              <Swatches label="Shirt" colors={SHIRT} value={gm.shirt} onChange={set('shirt')} />
              <Swatches label="Tie" colors={TIE} value={gm.tie} onChange={set('tie')} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="fo-muted" style={{ marginTop: 0, marginBottom: 14, maxWidth: '76ch' }}>
              Payroll and cap position are real. A second-apron team cannot aggregate salaries or take
              back more than it sends — that is a genuinely hard job. A team under the cap has room
              and not much else. The club&apos;s colours run through the whole interface.
            </p>
            <div className="fo-seg" style={{ marginBottom: 14 }}>
              <button type="button" aria-pressed={realPicks} onClick={() => setRealPicks(true)}>Real draft picks</button>
              <button type="button" aria-pressed={!realPicks} onClick={() => setRealPicks(false)}>Everyone owns their own</button>
            </div>
            <p className="fo-muted" style={{ marginTop: 0, marginBottom: 14, maxWidth: '76ch', fontSize: 13 }}>
              {realPicks
                ? `The ledger as it actually stands (${REAL_PICKS_SOURCE}) — Oklahoma City holding eighteen picks, `
                  + 'Denver down to four, Utah\u2019s protections, the Clippers\u2019 forfeited firsts. Inheriting somebody '
                  + 'else\u2019s obligations is most of the job.'
                : 'Every club starts with its own five firsts and five seconds and nothing else. A fair fight, '
                  + 'and much easier to hold in your head.'}
            </p>
            <div className="fo-teamgrid">
              {rows.map((r) => {
                const [c1] = CLUB[r.t] || ['#00A2E8']
                const [city, nm] = CITY[r.t]
                return (
                  <button key={r.t} type="button" className="fo-teamcard" aria-pressed={team === r.t}
                    style={{ '--pc': c1 }} onClick={() => setTeam(r.t)}>
                    <div className="top">
                      <span className="badge" style={{ background: c1, color: '#0A0C11' }}>{r.t}</span>
                      <span>
                        <span className="cty">{city}</span>
                        <span className="tn">{nm}</span>
                      </span>
                    </div>
                    <div className="fin">
                      <span>{short(r.tot)}</span>
                      <span style={{ color: r.label.includes('apron') ? 'var(--bad)'
                        : r.label === 'under the cap' ? 'var(--good)' : 'var(--faint)' }}>{r.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <ModePicker levels={levels} onPick={(m) => { setPreset(m.key); setLevels({ ...m.levels }) }} />
            <ControlSurface preset={preset} levels={levels}
              onPreset={(k) => { setPreset(k); setLevels({ ...SEED.presets[k].levels }) }}
              onLevel={(k, v) => { setLevels((l) => ({ ...l, [k]: v })); setPreset('custom') }} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        marginTop: 26, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
        {step > 0
          ? <button className="fo-btn ghost" type="button" onClick={() => setStep(step - 1)}>Back</button>
          : <button className="fo-btn ghost" type="button" onClick={onCancel}>Back to franchises</button>}
        {step < 2
          ? <button className="fo-btn" type="button" disabled={!canGo} onClick={() => setStep(step + 1)}>Continue</button>
          : <button className="fo-btn" type="button"
              onClick={() => onHire({ gm, team, preset, levels, slot, realPicks })}>Take the job</button>}
        {step === 0 && !canGo && <span className="fo-k">Name yourself first</span>}
        {step === 2 && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar gm={gm} size={34} />
            <span className="fo-k">{gm.name} · {team} · {SEED.presets[preset]?.label || 'Custom'}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- control surface */

// Three doors before the ten dials. Nobody arriving at a front-office game wants to rule
// on two-way contracts before they have made a trade — but the dials stay, underneath, for
// anyone who wants them.
function ModePicker({ levels, onPick }) {
  const current = modeOf({ controlSurface: { levels } })
  return (
    <div className="fo-modes">
      {MODES.map((m) => {
        const on = current.key === m.key
        const mine = Object.values(m.levels).filter((v) => v === 'manual').length
        return (
          <button key={m.key} type="button" className={`mode${on ? ' on' : ''}`}
            aria-pressed={on} onClick={() => onPick(m)}>
            <span className="tag">{m.tag}</span>
            <b>{m.label}</b>
            <span className="bl">{m.blurb}</span>
            <span className="dt">{m.detail}</span>
            <span className="ct">{mine} of 10 decisions are yours</span>
          </button>
        )
      })}
    </div>
  )
}

const LEVELS = [['manual', 'Me'], ['advised', 'Advised'], ['auto', 'Auto']]

function ControlSurface({ preset, levels, onPreset, onLevel }) {
  return (
    <div>
      <div className="fo-seg">
        {Object.entries(SEED.presets).map(([k, p]) => (
          <button key={k} type="button" aria-pressed={preset === k} onClick={() => onPreset(k)}>{p.label}</button>
        ))}
      </div>
      <p className="fo-muted" style={{ marginTop: 0 }}>{SEED.presets[preset]?.blurb
        || 'Custom — you have changed individual domains.'}</p>
      <div style={{ display: 'grid', gap: '0 26px', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', marginTop: 14 }}>
        {Object.entries(SEED.domains).map(([k, d]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5 }}>{d.label}</div>
              <div className="fo-faint" style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 3 }}>
                {levels[k] === 'auto' ? d.auto : d.blurb}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flex: 'none' }}>
              {LEVELS.map(([v, lab]) => (
                <button key={v} type="button" className="fo-opt" aria-pressed={levels[k] === v}
                  onClick={() => onLevel(k, v)} style={{ padding: '5px 8px', fontSize: 10 }}>{lab}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ screens */

// The card that answers "what am I supposed to be doing right now". A season that is one
// button is not a game; a season that tells you what this stage is for, checks whether you
// did it, and then moves on, is.
function PhaseCard({ save, ctx, onGo, onAdvance, busy }) {
  const phase = phaseOf(save)
  const objs = objectives(save, ctx)
  const gate = canAdvance(save, ctx)
  const idx = PHASES.indexOf(phase)
  const next = nextPhase(phase.key)
  return (
    <Card title={phase.name} note={`${phase.date} · stage ${idx + 1} of ${PHASES.length}`}>
      <div className="fo-track">
        {PHASES.map((p, i) => (
          <Tip key={p.key} tip={`${p.name} — ${p.date}`}>
            <span className={`pip${i < idx ? ' done' : i === idx ? ' on' : ''}`} />
          </Tip>
        ))}
      </div>
      <p className="fo-muted" style={{ fontSize: 13.5, margin: '12px 0 14px', lineHeight: 1.5 }}>
        {phase.blurb}
      </p>
      <div className="fo-objs">
        {objs.map((o) => (
          <button key={o.id} type="button" className={`fo-obj${o.done ? ' done' : ''}`}
            onClick={() => onGo(o.screen)}>
            <span className="box">{o.done ? '✓' : ''}</span>
            <span className="tx">
              <b>{o.text}</b>
              {o.why && <i>{o.why}</i>}
            </span>
            {!o.done && o.hard && <span className="fo-tag warn">required</span>}
          </button>
        ))}
        {!objs.length && <div className="fo-muted" style={{ fontSize: 13 }}>Nothing outstanding.</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 15, flexWrap: 'wrap' }}>
        <button className="fo-btn" type="button" disabled={!gate.ok || busy} onClick={onAdvance}>
          {busy ? 'Working…'
            : phase.games && (ctx.games ?? 0) < phase.games ? `Play to game ${phase.games}`
              : phase.next}
        </button>
        {!gate.ok && (
          <span className="fo-k" style={{ color: 'var(--warn)' }}>
            {gate.blocking[0].text} first
          </span>
        )}
        {gate.ok && next.key !== phase.key && (
          <span className="fo-k">then: {next.name} · {next.date}</span>
        )}
      </div>
    </Card>
  )
}

// One idea, the first time it matters. Not a manual, not a tooltip you have to find.
function Lesson({ lesson, onGot }) {
  if (!lesson) return null
  return (
    <div className="fo-lesson">
      {/* `where` is the situation a lesson BELONGS to, not a claim about what just happened.
          Rendered as "First time · {where}" it became one: opening the trade desk for the very
          first time and touching nothing produced "FIRST TIME · A TRADE THAT JUST GOT
          REJECTED", which had not. Said as a condition it is true wherever it appears. */}
      <div className="hd">
        <span className="tag">First time</span>
        <b>{lesson.title}</b>
        <span className="when">comes up at {lesson.where}</span>
      </div>
      <p>{lesson.body}</p>
      <button className="fo-btn sm" type="button" onClick={() => onGot(lesson.id)}>Got it</button>
    </div>
  )
}

// A badge is a percentile, so the card can always say what it took to earn one.
function BadgeRow({ badges, max = 4 }) {
  if (!badges?.length) return null
  return (
    <div className="fo-badges">
      {badges.slice(0, max).map((b) => (
        <Tip key={b.id} tip={`${b.tierLabel} — ${b.of} of ${b.value}. ${b.blurb}`}>
          <span className={`bdg ${b.tier}`}>{b.name}</span>
        </Tip>
      ))}
    </div>
  )
}

function Tendencies({ list }) {
  if (!list?.length) return null
  return (
    <div className="fo-tend">
      {list.map((t) => (
        <div key={t.id} className="row">
          <Tip tip={t.blurb}><span className="k">{t.name}</span></Tip>
          <span className="bar"><i style={{ width: `${Math.max(2, t.pct * 100)}%` }} /></span>
          <span className="v">{t.display}</span>
          <span className="lb">{t.label}</span>
        </div>
      ))}
    </div>
  )
}

function PlayerRow({ p, right }) {
  const ovr = ovrOf(p)
  const av = availTag(p)
  return (
    <div className="fo-row">
      <span className="fo-av">{initials(p.n)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="nm"><PName p={p} />{av && <Tip tip={av.tip}><span className="fo-tag warn">{av.label}</span></Tip>}</span>
        <span className="sub">{p.pos || '—'} · {p.a || '—'} · {p.arch || 'unrated'}</span>
      </span>
      {right || (ovr && (
        <Tip tip={OVR_TIP} right>
          <span className="r"><b>{ovr}</b><span>OVR</span></span>
        </Tip>
      ))}
    </div>
  )
}

function CampPanel({ save, onSet }) {
  const EMPHASIS = [
    ['shooting', 'Shooting', 'Most of the gain goes to the players who already take threes.'],
    ['defense', 'Defence', 'Point-of-attack defence and rim protection — the two axes the fit model rates highest after gravity.'],
    ['conditioning', 'Conditioning', 'Buys durability (injury x0.83) and no skill at all. Worth it for an old roster.'],
    ['development', 'Young player development', 'Skill work returns more than twice as much at 22 as at 34.'],
  ]
  return (
    <Card title="Emphasis" note="One thing the team works on all year">
      <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        One emphasis for the year. The returns are age-dependent and measured, not flat.
      </p>
      <div className="fo-objs">
        {EMPHASIS.map(([k, label, why]) => (
          <button key={k} type="button" className={`fo-obj${save.camp?.emphasis === k ? ' done' : ''}`}
            onClick={() => onSet({ emphasis: k })}>
            <span className="box">{save.camp?.emphasis === k ? '✓' : ''}</span>
            <span className="tx"><b>{label}</b><i>{why}</i></span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function HomeScreen({ save, roster, rating, onGo, phaseCtx, onAdvance, onCamp, busy, adv, voice, onVoice }) {
  const tot = teamSalary(roster)
  const st = status(tot)
  const label = statusLabel(st)
  const expiring = roster.filter((p) => (p.yr || 1) === 1)
  const parts = [
    { k: 'Player salaries', v: tot * 0.9, c: 'var(--acc)' },
    { k: 'Cap holds', v: tot * 0.06, c: 'var(--acc-2)' },
    { k: 'Tax exposure', v: Math.max(0, tot - CBA.tax), c: '#E2574C' },
    { k: 'Exceptions', v: CBA.mle_nontax, c: '#5B6478' },
  ].filter((p) => p.v > 0)

  // The task list is now the REAL objectives for the phase you are in. The hand-written
  // version it replaces was wrong in the way hand-written lists always are: it offered
  // "Re-sign Garza" as HIGH priority in October and sent you to an offseason screen that
  // does not open until June.
  const tasks = objectives(save, phaseCtx)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Welcome, {save.gm.name || 'GM'}</h2>
        <p>What would you like to focus on today?</p>
      </div>

      {adv && (
        <div style={{ marginBottom: 14 }}>
          <AdvisorCard save={save} adv={adv} voice={voice} onVoice={onVoice} onGo={onGo}
            teaching={isFirstCareerYear(save) ? coachingFor(save) : null} />
        </div>
      )}

      <div className="fo-grid" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', marginBottom: 14 }}>
        <PhaseCard save={save} ctx={phaseCtx} onGo={onGo} onAdvance={onAdvance} busy={busy} />
        {phaseOf(save).key === 'camp'
          ? <CampPanel save={save} onSet={onCamp} />
          : (
            <Card title="Around the league" note="What the other twenty-nine are doing">
              {(phaseCtx.wire || []).length === 0 && (
                <div className="fo-empty">Quiet week. Nothing has moved.</div>
              )}
              {(phaseCtx.wire || []).slice(0, 6).map((w, i) => (
                <div key={i} className="fo-row">
                  <span style={{ fontSize: 13 }}>{w}</span>
                </div>
              ))}
            </Card>
          )}
      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,.85fr)' }}>
        <div className="fo-hero">
          <Arena />
          <div className="veil" />
          <div className="in">
            <div className="eye">{save.franchise.currentSeason} · {save.records.seasonsCompleted ? `season ${save.records.seasonsCompleted + 1}` : 'day one'}</div>
            <h3>{st.overApron2 ? 'Squeezed at the second apron'
              : st.overApron1 ? 'Over the first apron'
              : st.underCap ? 'Room to build' : 'Shape the season'}</h3>
            <p>{expiring.length} contract{expiring.length === 1 ? '' : 's'} expiring, {roster.length} on the books,
              and {label === 'under the cap' ? `${short(st.space)} of room` : `${short(Math.abs(tot - CBA.apron1))} ${tot > CBA.apron1 ? 'over' : 'under'} the first apron`}.</p>
            <button className="fo-btn" style={{ marginTop: 18 }} type="button"
              onClick={() => onGo('season')}>Play the season →</button>
          </div>
        </div>

        <Card title="Team overview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span className="fo-crest" style={{ width: 48, height: 48, fontSize: 15 }}>{save.franchise.team}</span>
            <Tip tip="Minutes-weighted average of your top nine rated players.">
              <Ring value={rating.ovr} size={62} />
            </Tip>
            <div style={{ display: 'flex', gap: 16 }}>
              <Tip tip="Shot creation across the roster, weighted by minutes.">
                <span style={{ textAlign: 'center', display: 'block' }}>
                  <b style={{ font: '700 20px/1 "Inter Tight",sans-serif', display: 'block' }}>{rating.off}</b>
                  <span className="fo-k">OFF</span></span>
              </Tip>
              <Tip tip="Perimeter defence across the roster, weighted by minutes.">
                <span style={{ textAlign: 'center', display: 'block' }}>
                  <b style={{ font: '700 20px/1 "Inter Tight",sans-serif', display: 'block' }}>{rating.def}</b>
                  <span className="fo-k">DEF</span></span>
              </Tip>
            </div>
          </div>
          <div className="fo-cells" style={{ gridTemplateColumns: '1fr 1fr .9fr', marginTop: 14 }}>
            <div><div className="fo-k">Conference</div><div className="v">{SEED.teams[save.franchise.team].conf}</div></div>
            <div><div className="fo-k">Division</div><div className="v">{SEED.teams[save.franchise.team].div}</div></div>
            <div><div className="fo-k">Titles</div><div className="v">{save.records.championships}</div></div>
          </div>
          <div className="fo-k" style={{ margin: '14px 0 6px' }}>Top players</div>
          {rating.rated.slice(0, 3).map((p, i) => <PlayerRow key={`${p.uid || p.n}-${i}`} p={p} />)}
        </Card>

        <Card title="Tasks">
          {tasks.length === 0 && (
            <div className="fo-empty">Nothing outstanding. Move the calendar on.</div>
          )}
          {tasks.map((t) => (
            <Tip key={t.id} as="div" tip={t.why}>
              <button type="button" onClick={() => onGo(t.screen)} className={`fo-task${t.done ? ' done' : ''}`}>
                <span className="tick">{t.done ? '\u2713' : ''}</span>
                <span className="lb">{t.text}</span>
                {!t.done && t.hard && <span className="req">required</span>}
              </button>
            </Tip>
          ))}
        </Card>
      </div>

      <div className="fo-grid" style={{ marginTop: 14, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr)' }}>
        <Card title="Cap position">
          <div className="fo-k">Team payroll</div>
          <div className="fo-big fo-acc" style={{ marginTop: 6 }}>{short(tot)}</div>
          <div className="fo-k" style={{ marginTop: 6, color: 'var(--acc-2)' }}>{label}</div>
          <p className="fo-muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 8 }}>
            {APRON_CONSEQUENCE[label]}
          </p>
          <button className="fo-btn ghost" style={{ width: '100%', marginTop: 12 }} type="button"
            onClick={() => onGo('roster')}>Open the cap sheet</button>
        </Card>

        <Card title="Salary breakdown">
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <Donut parts={parts} center={short(tot)} sub="TEAM PAYROLL" />
            <div style={{ flex: 1, minWidth: 160 }}>
              {parts.map((p) => (
                <div key={p.k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.c, flex: 'none' }} />
                  {p.k}
                  <span style={{ marginLeft: 'auto', font: '600 12.5px/1 "IBM Plex Mono",monospace' }}>{short(p.v)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="fo-cells" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 12 }}>
            <Tip tip="Room under the salary cap. Only a team with space can sign a big free agent outright — which is exactly why Bird rights matter." as="div">
              <div><div className="fo-k">Cap space</div><div className="v">{st.space > 0 ? short(st.space) : '—'}</div></div>
            </Tip>
            <Tip tip="First apron: no sign-and-trade acquisitions, no non-taxpayer mid-level, no bi-annual exception." as="div">
              <div><div className="fo-k">1st apron</div>
                <div className="v" style={{ color: tot > CBA.apron1 ? 'var(--bad)' : 'var(--good)' }}>
                  {short(CBA.apron1 - tot)}</div></div>
            </Tip>
            <Tip tip="Second apron: cannot aggregate salaries, cannot take back more than you send, cannot send cash, frozen future first." as="div">
              <div><div className="fo-k">2nd apron</div>
                <div className="v" style={{ color: tot > CBA.apron2 ? 'var(--bad)' : 'var(--good)' }}>
                  {short(CBA.apron2 - tot)}</div></div>
            </Tip>
          </div>
        </Card>

        <Card title="Trophy case">
          <div style={{ display: 'grid', gap: 6 }}>
            {[['Championships', save.records.championships],
              ['Seasons', save.records.seasonsCompleted],
              ['Career record', `${save.records.totalWins}–${save.records.totalLosses}`],
              ['Best season', save.records.bestRecord ? `${save.records.bestRecord.wins}–${save.records.bestRecord.losses}` : '—'],
              ['Trades made', save.records.tradesMade || 0]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 }}>
                <span className="fo-faint">{k}</span>
                <span style={{ marginLeft: 'auto', font: '600 13px/1 "IBM Plex Mono",monospace' }}>{v}</span>
              </div>
            ))}
          </div>
          {save.badges?.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {save.badges.map((b) => {
                const meta = BADGES.find((x) => x.id === b)
                return <Tip key={b} tip={meta?.blurb || ''}>
                  <span className="fo-tag" style={{ marginLeft: 0, padding: '4px 8px' }}>{meta?.name || b}</span>
                </Tip>
              })}
            </div>
          )}
          {!save.badges?.length && (
            <p className="fo-faint" style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.45 }}>
              Empty for now. Banners hang here.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

// 240 minutes, and every one you give somebody comes off somebody else.
// Every player's name in this game opens his page. Threading a handler down to the ten
// components that render a name would have meant ten chances to forget one, and a name that
// is clickable in four places and dead in six is worse than one that is never clickable at
// all — so the handler goes in a context and `PName` is the only thing that renders a name.
const PlayerLink = createContext(null)

function PName({ p, name, className = '', children, ...rest }) {
  const open = useContext(PlayerLink)
  const id = p ? (p.uid || p.n) : name
  const label = children ?? (p ? p.n : name)
  if (!open || !id) return <span className={className} {...rest}>{label}</span>
  return (
    <span role="button" tabIndex={0} className={`fo-name ${className}`} {...rest}
      onClick={(e) => { e.stopPropagation(); open(id) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); open(id) } }}>
      {label}
    </span>
  )
}

/* ------------------------------------------------------------- the player page */

// The Savant page, in the game's clothes. It is an OVERLAY, deliberately: the screen
// underneath never unmounts, so a half-built trade with four players and two picks selected
// is exactly where you left it when you come back. Anything that navigated away would have
// to rebuild that state, and rebuilding it is how you lose it.
function SvBar({ row }) {
  const p = row.p
  const tone = p === null ? 'na' : p >= 80 ? 'elite' : p >= 60 ? 'good' : p >= 40 ? 'mid' : 'poor'
  const body = (
    <div className={`sv-bar ${tone}`}>
      <span className="k">{row.k}</span>
      <span className="track"><i style={{ width: `${p ?? 0}%` }} /></span>
      <span className="v">{row.v}</span>
      <span className="p">{p === null ? '—' : p}</span>
    </div>
  )
  return row.why ? <Tip as="div" tip={`${row.why} League percentile: ${p ?? '—'}.`}>{body}</Tip> : body
}

function SavantColumn({ title, rows, note }) {
  return (
    <div className="sv-col">
      <div className="sv-h">{title}{note ? <i>{note}</i> : null}</div>
      {rows.map((r) => <SvBar key={r.k} row={r} />)}
    </div>
  )
}

function Spark({ points, height = 46 }) {
  if (!points || points.length < 2) return null
  const vals = points.map((x) => x.vorp ?? 0)
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals)
  const w = 100, step = w / (vals.length - 1)
  const y = (v) => height - ((v - lo) / (hi - lo || 1)) * (height - 6) - 3
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="sv-spark" aria-hidden="true">
      <path d={`${d} L${w},${height} L0,${height} Z`} className="fill" />
      <path d={d} className="line" />
    </svg>
  )
}

function PlayerProfile({ entry, onBack, onOpen, depth, mine }) {
  const { cap, sim, team } = entry
  const pr = useMemo(() => savantProfile(cap, sim, team), [cap, sim, team])
  const [c1] = CLUB[team] || ['#5B6478']
  // A free agent belongs to nobody, and the page should say so rather than inventing a club.
  const [city, nm] = CITY[team] || ['Free', 'agent']
  const ovr = ovrOf(cap)
  const mv = pr.market
  const proj = pr.projection || []
  const yrs = Math.max(1, cap.yr || 1)

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onBack])

  return (
    <div className="fo-cast fo-savant" role="dialog" aria-modal="true">
      <div className="sv-in" style={{ '--pc': c1 }}>
        <div className="sv-top">
          <button className="fo-btn ghost sm" type="button" onClick={onBack}>
            ← {depth > 1 ? 'Back' : 'Back to where I was'}
          </button>
          <span className="fo-k" style={{ marginLeft: 'auto' }}>
            {SEED.season} · Basketball Savant
          </span>
        </div>

        <div className="sv-hero">
          <span className="crest" style={{ background: c1, color: team ? clubInk(team) : '#0A0C11' }}>
            {team || 'FA'}
          </span>
          <div className="who">
            <h3>{cap.n}</h3>
            <div className="sub">
              {team ? `${city} ${nm}` : 'Unsigned'} · {cap.pos || '—'} · {cap.arch || 'rotation player'} ·
              age {typeof cap.a === 'number' ? cap.a.toFixed(1) : '—'}
              {team === mine ? <b className="ours"> your player</b> : null}
            </div>
          </div>
          <div className="rings">
            <Ring value={ovr} label="OVR" floor={40} />
          </div>
        </div>

        {/* A situation belongs at the top of his page, because it is the first thing that
            changes what you would do about him. */}
        {(() => {
          const sit = situationOf(cap)
          if (!sit || sit.state === SITUATION.CONTENT) return null
          const line = wireLine(cap.n, (CITY[sit.team] || [])[1] || sit.team, sit)
          return (
            <div className={`sv-sit ${sit.state}`}>
              <span className="tag">{SIT_LABEL[sit.state]}</span>
              <span className="tx">{line}</span>
            </div>
          )
        })()}

        <div className="sv-strip">
          {[['Salary', fmt(cap.s)], ['Years left', yrs], ['VORP', (cap.v ?? 0).toFixed(2)],
            ['Available', typeof cap.av === 'number' ? `${Math.round(cap.av)}%` : '—'],
            ['Trade value', short(mv.value)]].map(([k, v]) => (
              <div key={k}><span className="fo-k">{k}</span><b>{v}</b></div>
            ))}
        </div>

        {pr.badges.length > 0 && (
          <div className="sv-sec">
            <div className="fo-k" style={{ marginBottom: 8 }}>What he is good at</div>
            <BadgeRow badges={pr.badges} max={10} />
          </div>
        )}

        <div className="sv-cols">
          <SavantColumn title="Offense" rows={pr.offense} note="percentile of the league rotation" />
          <SavantColumn title="Defense" rows={pr.defense} />
          <div className="sv-col">
            <div className="sv-h">Value</div>
            {pr.value.map((r) => <SvBar key={r.k} row={r} />)}
            <div className="sv-proj">
              <div className="fo-k">Next five years</div>
              <Spark points={proj} />
              <div className="lbl">
                <span>{(proj[0]?.vorp ?? 0).toFixed(1)} VORP now</span>
                <span>{(proj[proj.length - 1]?.vorp ?? 0).toFixed(1)} in five</span>
              </div>
              <p className="fo-faint">
                What the projection model expects, not what he did. A trade is about the second one.
              </p>
            </div>
          </div>
        </div>

        <div className="sv-cols two">
          <div className="sv-col">
            <div className="sv-h">How he plays<i>the possession engine&apos;s own inputs</i></div>
            <Tendencies list={tendenciesFor(sim)} />
            {!sim && <div className="fo-empty">No profile on file.</div>}
          </div>
          <div className="sv-col">
            <div className="sv-h">Most like<i>Basketball Savant&apos;s own comparisons</i></div>
            {pr.comps.length === 0 ? (
              <div className="fo-empty">
                No comparison on file — he has not played an NBA season yet.
              </div>
            ) : (
              <>
                {pr.comps.map((c) => (
                  <button key={c.name} type="button" className="sv-comp"
                    disabled={!c.inLeague}
                    onClick={() => c.inLeague && onOpen(c.cap.uid || c.name)}>
                    <span className="cr" style={{ background: (CLUB[c.team] || [])[0], color: clubInk(c.team) }}>
                      {c.team}
                    </span>
                    <span className="nm">{c.name}</span>
                    <span className="sim">{c.similarity}%</span>
                  </button>
                ))}
                <p className="fo-faint" style={{ fontSize: 11.5, marginTop: 9 }}>
                  The same comparisons the site publishes, computed across his whole statistical
                  profile rather than the nine axes on this page — so a comp is somebody who does
                  a similar job, not somebody with similar counting stats.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- advisor */

// The answer to "what do I do to be good", assembled from measurements that already
// existed and were never read out loud in one place. Two voices, because the right one
// depends on how much you already know: a recommendation with the reasoning attached, or
// the same facts with the choice left to you.
function GradeChip({ g }) {
  const tone = g.score >= 70 ? 'good' : g.score >= 50 ? 'warn' : 'bad'
  return (
    <Tip as="div" className={`fo-grade ${tone}`} tip={`${g.why} ${g.lever}`}>
      <span className="lt">{g.grade}</span>
      <span className="lb">{g.label}</span>
      <span className="fc">{g.fact}</span>
    </Tip>
  )
}

function AdvisorCard({ save, adv, voice, onVoice, onGo, teaching }) {
  const items = adv.items.slice(0, 3)
  return (
    <Card title="The front office" note={adv.grades.grade}>
      <div className="fo-advverdict">{adv.verdict}</div>

      {/* Three letters with no frame around them is a quiz, not a briefing: a newcomer sees
          "B" and has no idea what it is out of or what it is against. Each chip's tooltip has
          always explained itself, but a tooltip is hover-only — invisible on a phone and
          undiscoverable to somebody who does not yet know there is something to discover. One
          line above the row says what is being marked and against what. */}
      <div className="fo-k" style={{ margin: '2px 0 7px' }}>
        How the club stands — marked against the job ownership gave you
      </div>
      <div className="fo-grades">
        {adv.grades.list.map((g) => <GradeChip key={g.key} g={g} />)}
      </div>
      <div className="fo-gradekey">
        <b>A</b> comfortably ahead of it · <b>C</b> on track · <b>F</b> failing it
        <i>hover any of them for what is behind the mark, and what to do about it</i>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '15px 0 9px', flexWrap: 'wrap' }}>
        <div className="fo-k">What is worth doing</div>
        <div className="fo-seg sm" style={{ marginLeft: 'auto' }}>
          <button type="button" aria-pressed={voice === 'tell'} onClick={() => onVoice('tell')}>Tell me</button>
          <button type="button" aria-pressed={voice === 'read'} onClick={() => onVoice('read')}>Just the facts</button>
        </div>
      </div>

      <div className="fo-advice">
        {items.map((it) => (
          <div key={it.key} className={`item ${it.tone}`}>
            <div className="hd">
              <b>{it.title}</b>
              <span className="fc">{voice === 'read' ? (it.factRead || it.fact) : it.fact}</span>
            </div>
            <p>{voice === 'read' ? it.read : it.tell}</p>
            {it.screen && (
              <button className="fo-btn ghost sm" type="button" onClick={() => onGo(it.screen)}>
                {it.screen === 'trades' ? 'Open the trade desk'
                  : it.screen === 'market' ? 'Open the market'
                    : it.screen === 'job' ? 'See the job'
                      : `Go to ${it.screen}`}
              </button>
            )}
          </div>
        ))}
      </div>

      {teaching && (
        <div className="fo-coaching">
          <div className="fo-k">What a good general manager does here</div>
          <p>{teaching}</p>
        </div>
      )}
    </Card>
  )
}

// What the roster lacks, on every screen where you might act on it.
function NeedsRow({ needs, compact }) {
  const list = needs.filter((n) => n.severity === 'hole' || n.severity === 'thin')
    .filter((n) => n.weight >= NEED_WEIGHT_FLOOR).slice(0, compact ? 2 : 3)
  const good = needs.filter((n) => n.severity === 'strength' && n.weight >= NEED_WEIGHT_FLOOR).slice(0, 2)
  if (!list.length && !good.length) return null
  return (
    <div className="fo-needs">
      {list.map((n) => (
        <Tip key={n.key} as="span" className={`nd ${n.severity}`}
          tip={`${Math.abs(n.z).toFixed(1)} standard deviations below league average on an axis the fit `
            + `model weights ${n.weight.toFixed(2)}. What fixes it: ${n.fix}.`}>
          <i>{n.severity === 'hole' ? 'need' : 'thin'}</i> {n.label}
        </Tip>
      ))}
      {good.map((n) => (
        <Tip key={n.key} as="span" className="nd strength"
          tip={`${n.z.toFixed(1)} standard deviations above league average. This is what your roster is for.`}>
          <i>strength</i> {n.label}
        </Tip>
      ))}
    </div>
  )
}

function RotationScreen({ roster, sim, minutes, wear, onSet, onAuto, onEven }) {
  // The order is FIXED while you edit. Sorting the rows by live minutes meant every drag
  // re-sorted the list under the cursor and you ended up moving somebody else — which is
  // the whole of "I slide one slider and it messes everything up".
  const rows = useMemo(() => rotationOrder(roster, bandOf, ratePerMin), [roster])
  const adv = rotationAdvice(minutes, roster, sim, bandOf, ratePerMin)
  const BANDS = [['guard', 'Guards'], ['wing', 'Wings'], ['big', 'Bigs']]
  const pct = Math.min(100, (adv.total / TEAM_MINUTES) * 100)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Rotation</h2>
        <p>Five players for forty-eight minutes is {TEAM_MINUTES} a night, and that is the whole
          budget. A slider moves that player and nobody else, so the total is allowed to be
          wrong — the tag says when it is, and one button spreads the difference across
          everybody else. The minutes you set here are the load the engine actually reads.</p>
      </div>

      <Card title="Minutes" note={`${adv.total} of ${TEAM_MINUTES} · ${adv.playing} in the rotation`}>
        <div className="fo-budget">
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="segs">
            {BANDS.map(([k, label]) => (
              <span key={k}>{label} <b>{adv.bands[k] || 0}</b></span>
            ))}
            <span className="tot">Total <b>{adv.total}</b> / {TEAM_MINUTES}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0 4px' }}>
          <button className="fo-btn ghost sm" type="button" onClick={onAuto}>Let the coach set it</button>
          {adv.total !== TEAM_MINUTES && (
            <button className="fo-btn sm" type="button" onClick={onEven}>
              Even out the other {Math.abs(adv.total - TEAM_MINUTES)}
            </button>
          )}
          <span className={`fo-tag${adv.total === TEAM_MINUTES ? '' : ' warn'}`}>
            {adv.total === TEAM_MINUTES ? 'Balanced'
              : `${adv.total > TEAM_MINUTES ? 'Over' : 'Short'} by ${Math.abs(adv.total - TEAM_MINUTES)}`}
          </span>
        </div>

        {adv.notes.map((n, i) => (
          <div key={i} className={`fo-verdict ${n.tone === 'bad' ? 'no' : n.tone === 'good' ? 'ok' : ''}`}
            style={{ marginTop: 10 }}>
            <div className="d" style={{ marginTop: 0 }}>{n.text}</div>
          </div>
        ))}

        <div className="fo-rot" style={{ marginTop: 14 }}>
          {BANDS.map(([band, label]) => {
            const group = rows.filter((p) => bandOf(p).key === band)
            if (!group.length) return null
            return (
              <div key={band}>
                <div className="fo-k" style={{ margin: '13px 0 6px' }}>
                  {label} <span className="fo-faint">· {adv.bands[band] || 0} minutes</span>
                </div>
                {group.map((p) => {
                  const key = p.uid || p.n
                  const m = minutes[key] || 0
                  const sp = (sim || []).find((x) => x.n === p.n)
                  const safe = sustainable(p, sp)
                  const st = strain(p, sp, m)
                  const now = availabilityNow(p, wear)
                  const lost = Math.round((p.av ?? 75) - now)
                  return (
                    <div key={key} className={`row${m ? '' : ' out'}`}>
                      <span className="nm"><PName p={p} />
                        <i>{p.pos || '—'} · can carry {Math.round(safe)} · {Math.round(now)}% available
                          {lost > 1 ? <b className="worn"> −{lost}</b> : null}</i></span>
                      <Tip as="span" className="sld"
                        style={{ '--safe': `${Math.min(100, (safe / MAX_MINUTES) * 100)}%` }}
                        tip={`The mark on the track is ${Math.round(safe)} minutes — what he has shown he can carry.`}>
                        <input type="range" min="0" max={MAX_MINUTES} value={m}
                          onChange={(e) => onSet(key, Number(e.target.value))} />
                      </Tip>
                      <span className="mn">{m}</span>
                      <Tip right tip={`He has shown he can carry about ${Math.round(safe)} minutes — last
                        season's load adjusted for how much of it he was available for${(p.a ?? 26) > 31
                          ? ', with an age penalty past 31' : ''}. Past that you are spending availability.`}>
                        <span className={`st ${st.risk}`}>{st.risk}</span>
                      </Tip>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function RosterScreen({ roster, sim, needs }) {
  const tot = teamSalary(roster)
  const rated = roster.map((p) => ({ ...p, ovr: ovrOf(p) }))
  const [pick, setPick] = useState(null)
  const shown = pick && rated.find((p) => (p.uid || p.n) === pick) ? rated.find((p) => (p.uid || p.n) === pick) : rated[0]
  const shownSim = shown ? (sim || []).find((x) => x.n === shown.n) : null
  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Cap sheet</h2>
        <p>Every contract on the books for {SEED.season}. Option years are flagged; overall is a
          production percentile, not a typed rating.</p>
        {needs && <NeedsRow needs={needs} />}
      </div>

      {shown && (
        <div className="fo-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', marginBottom: 14 }}>
          <Card title={<PName p={shown} />} note={`${shown.pos || '—'} · age ${typeof shown.a === 'number' ? shown.a.toFixed(1) : '—'} · ${shown.arch || '—'}`}>
            <div className="fo-k" style={{ marginBottom: 9 }}>What he is good at</div>
            <BadgeRow badges={badgesFor(shown)} max={8} />
            {!badgesFor(shown).length && (
              <div className="fo-muted" style={{ fontSize: 12.5 }}>
                No badge reaches the eightieth percentile. A rotation player, not a specialist.
              </div>
            )}
            <div className="fo-k" style={{ margin: '16px 0 9px' }}>Contract</div>
            <div className="fo-measure">
              {[['SALARY', short(shown.s)], ['YEARS', shown.yr], ['OVR', shown.ovr],
                ['AVL', typeof shown.av === 'number' ? `${Math.round(shown.av)}%` : '—']]
                .map(([k, v]) => <div key={k}><b>{v}</b><i>{k}</i></div>)}
            </div>
          </Card>
          <Card title="How he plays" note="the simulation's own inputs">
            <p className="fo-muted" style={{ fontSize: 12.5, margin: '0 0 11px' }}>
              These are not a second rating system — they are the rates the possession engine
              reads when it decides what he does with the ball.
            </p>
            <Tendencies list={tendenciesFor(shownSim)} />
            {!shownSim && <div className="fo-empty">No profile on file.</div>}
          </Card>
        </div>
      )}
      <Card flush note={`${roster.length} contracts · ${short(tot)}`}>
        <div style={{ overflowX: 'auto' }}>
          <table className="fo-tbl">
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th>Age</th><th>Archetype</th>
                <th>Yrs</th>
                <th><Tip tip="Share of last season the player was available for. It decides how often he DRESSES, not how much he plays: he is drawn for before each game, and the men who dress share the night by what they actually play.">AVL</Tip></th>
                <th><Tip tip={OVR_TIP}>OVR</Tip></th><th>{SEED.season}</th>
              </tr>
            </thead>
            <tbody>
              {rated.map((p, i) => (
                <tr key={`${p.uid || p.n}-${i}`} onClick={() => setPick(p.uid || p.n)}
                  className={(shown && (shown.uid || shown.n) === (p.uid || p.n)) ? 'on' : ''}
                  style={{ cursor: 'pointer' }}>
                  <td>
                    <PName p={p} />
                    {p.o && <span className="fo-tag">{p.o}</span>}
                  </td>
                  <td className="n fo-faint">{p.pos || '—'}</td>
                  <td className="n fo-faint">{typeof p.a === 'number' ? p.a.toFixed(1) : '—'}</td>
                  <td className="n fo-muted" style={{ fontFamily: 'inherit' }}>{p.arch || '—'}</td>
                  <td className="n fo-faint">{p.yr}</td>
                  <td className="n" style={{ color: typeof p.av === 'number' && p.av < 62 ? 'var(--warn)' : 'var(--faint)' }}>
                    {typeof p.av === 'number' ? `${Math.round(p.av)}%` : '—'}</td>
                  <td className="n" style={{ color: p.ovr >= 85 ? 'var(--acc)' : 'inherit', fontWeight: 600 }}>
                    {p.ovr || '—'}</td>
                  <td className="n">{fmt(p.s)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={7}>Team salary</td>
                <td className="n">{fmt(tot)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ trades */

function assetWorth(p) {
  const v = p.v ?? 0
  const base = SEED.picks.replacement + v * SEED.picks.perVorp
  const yrs = Math.max(1, p.yr || 1)
  let t = 0
  for (let i = 0; i < yrs; i++) t += (base - p.s) * Math.pow(SEED.picks.discount, i)
  return Math.max(-60e6, Math.min(60e6, t))
}

// Defined at module scope on purpose. As a function INSIDE TradeScreen it was a new
// component type on every render, so React threw the panel away and rebuilt it after each
// click — selections looked like they did nothing and the verdict never moved.
// Picks, split by round and annotated with what they actually are. A protected pick and
// an unprotected one look identical in a list and are not remotely the same asset, so the
// protection, the swap and the odds of the thing conveying are all on the row.
function PickList({ picks, sel, onT, ranks, year, groups, compact }) {
  const rounds = [[1, 'First-round picks'], [2, 'Second-round picks']]
  return (
    <>
      {rounds.map(([r, title]) => {
        const list = picks.filter((p) => p.round === r)
        if (!list.length) return null
        return (
          <div key={r}>
            <div className="fo-k" style={{ margin: '12px 0 6px' }}>{title} <span className="fo-faint">· {list.length}</span></div>
            <div className="fo-scrollbox" style={{ maxHeight: compact ? 104 : 130 }}>
              {list.map((p) => {
                const k = pickKey(p)
                const odds = conveyanceOdds(p, ranks)
                const on = sel.includes(k)
                return (
                  <Tip key={k} as="div" tip={describePick(p, ranks, groups)}>
                    <button type="button" aria-pressed={on} onClick={() => onT(k)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '5px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                        background: on ? 'color-mix(in srgb,var(--acc) 16%,transparent)' : 'transparent',
                        border: `1px solid ${on ? 'var(--acc)' : 'transparent'}` }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pickLabel(p, ranks[p.from])}
                      </span>
                      {odds < 0.999 && (
                        <span style={{ font: '500 10px/1 "IBM Plex Mono",monospace', flex: 'none',
                          color: odds > 0.7 ? 'var(--warn)' : 'var(--bad)' }}>{Math.round(odds * 100)}%</span>
                      )}
                      <span style={{ marginLeft: 'auto', flex: 'none',
                        font: '500 11px/1 "IBM Plex Mono",monospace', color: 'var(--faint)' }}>
                        {short(pickValue(p, ranks[p.from], year))}</span>
                    </button>
                  </Tip>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

function TradeSide({ abbr, roster, picks, sel, selPicks, onT, onTP, out, inn, fit, ranks, year, groups }) {
  const st2 = status(teamSalary(roster))
  const budget = maxIncoming(out, st2)
  return (
    <Card title={abbr} note={`${short(st2.total)} · ${statusLabel(st2)}`}>
      {out > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 4,
          border: `1px solid ${budget - inn >= 0 ? 'var(--line)' : 'color-mix(in srgb,var(--bad) 45%,transparent)'}`,
          background: budget - inn >= 0 ? 'var(--panel-2)' : 'color-mix(in srgb,var(--bad) 8%,transparent)',
          font: '500 11.5px/1.5 "IBM Plex Mono",monospace',
          color: budget - inn >= 0 ? 'var(--muted)' : 'var(--bad)' }}>
          sends {short(out)} · may take back {short(budget)}
          {inn > 0 && ` · ${budget - inn >= 0 ? `${short(budget - inn)} of room left` : `${short(inn - budget)} over`}`}
        </div>
      )}
      <div className="fo-scrollbox fo-tradeside" style={{ maxHeight: 250 }}>
        {roster.map((p, i) => {
          const f = fit ? fit(p, sel.includes(i)) : null
          return (
            <button key={`${p.uid || p.n}-${i}`} type="button" aria-pressed={sel.includes(i)} onClick={() => onT(i)}
              title={f === false ? 'Adding him breaks salary matching for one of the two teams'
                : f === true ? 'This clears both teams’ salary-matching rules' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                background: sel.includes(i) ? 'color-mix(in srgb,var(--acc) 16%,transparent)' : 'transparent',
                border: `1px solid ${sel.includes(i) ? 'var(--acc)'
                  : f === true ? 'color-mix(in srgb,var(--good) 42%,transparent)' : 'transparent'}`,
                opacity: f === false ? 0.4 : 1 }}>
              <Tip as="span" tip={OVR_TIP}>
                <span className={`fo-ovr${ovrOf(p) >= 85 ? ' elite' : ovrOf(p) >= 72 ? ' good' : ''}`}>
                  {ovrOf(p) || '—'}
                </span>
              </Tip>
              <Tip as="span" tip={`Click the row to put ${p.n} in the deal; click his name to open his page — nothing you have selected is lost.`}
                style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <PName p={p} />
              </Tip>
              <span style={{ marginLeft: 'auto', font: '500 11.5px/1 "IBM Plex Mono",monospace', color: 'var(--faint)' }}>{fmt(p.s)}</span>
            </button>
          )
        })}
      </div>
      <PickList picks={picks} sel={selPicks} onT={onTP} ranks={ranks} year={year} groups={groups} />
    </Card>
  )
}

/* ------------------------------------------------------------- the open market */

// Free agency, all year round. The screen exists because a roster can fall under the
// fourteen-player minimum in December — through a trade, a waiver, a retirement — and in
// the real league the minimum-salary market is always open for exactly that reason.
function MarketScreen({ save, roster, onSign, onWaive, needs }) {
  const team = save.franchise.team
  const pool = poolOf(save)
  const check = rosterCheck(save)
  const exc = exceptionsFor(team, roster)
  const used = save.exceptionsUsed || {}
  const [sel, setSel] = useState(null)
  const [offer, setOffer] = useState(MIN_SALARY)
  const [years, setYears] = useState(1)
  const [q, setQ] = useState('')

  const list = useMemo(() => pool
    .filter((p) => !q || p.n.toLowerCase().includes(q.toLowerCase()))
    .slice()
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0)), [pool, q])

  const pick = (p) => { setSel(p); setOffer(Math.max(MIN_SALARY, poolAsk(p))); setYears(1) }
  const verdict = sel ? canSign(save, sel, offer) : null
  const ask = sel ? poolAsk(sel) : 0
  // He signs if the money reaches his number. Below it he waits for somebody else — which
  // is the whole of the minimum-salary market: everybody is available, nobody is free.
  const willSign = sel ? offer >= ask * 0.97 : false

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Open market</h2>
        <p>Everyone here is unsigned and can be had today. A minimum contract is available to
          every team at any point in the year, whatever your cap position — that door is never shut.</p>
        {needs && <NeedsRow needs={needs} />}
      </div>

      {!check.ok && (
        <div className="fo-verdict no" style={{ marginBottom: 14 }}>
          <div className="h fo-bad">{check.short ? 'You are short-handed' : 'You are over the limit'}</div>
          <div className="d">{check.detail}</div>
        </div>
      )}

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="Available" note={`${list.length} unsigned`}>
          <input className="fo-input" value={q} placeholder="Search the pool"
            onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 9 }} />
          <div className="fo-scrollbox" style={{ maxHeight: 380 }}>
            {list.length === 0 && <div className="fo-empty">Nobody left on the market.</div>}
            {list.map((p, i) => {
              const on = sel && (sel.uid || sel.n) === (p.uid || p.n)
              return (
                <button key={`${p.uid || p.n}-${i}`} type="button" aria-pressed={!!on} onClick={() => pick(p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                    padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                    background: on ? 'color-mix(in srgb,var(--acc) 16%,transparent)' : 'transparent',
                    border: `1px solid ${on ? 'var(--acc)' : 'transparent'}` }}>
                  <span className="fo-av sm">{initials(p.n)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><PName p={p} /></span>
                    <span className="fo-faint" style={{ fontSize: 10.5 }}>
                      {Math.round(p.a ?? 28)} yrs{p.from ? ` · waived by ${p.from}` : ' · unsigned'}
                    </span>
                  </span>
                  <span style={{ marginLeft: 'auto', flex: 'none',
                    font: '500 11.5px/1 "IBM Plex Mono",monospace', color: 'var(--faint)' }}>
                    {short(poolAsk(p))}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>

        <Card title="What you can offer" note={check.ok ? `${check.n} under contract` : `${check.n} under contract`}>
          {exc.map((e) => (
            <Tip key={e.key} as="div" tip={e.why}>
              <div className="fo-row">
                <span style={{ fontSize: 13, textDecoration: used[e.key] ? 'line-through' : 'none',
                  opacity: used[e.key] ? 0.45 : 1 }}>{e.label}</span>
                <span className="r"><b style={{ fontSize: 13.5 }}>
                  {used[e.key] ? 'spent' : e.cap > 0 ? short(e.cap) : '—'}</b></span>
              </div>
            </Tip>
          ))}
          {!sel ? (
            <div className="fo-empty" style={{ marginTop: 12 }}>Pick somebody to make an offer.</div>
          ) : (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}><PName p={sel} /></div>
              <div className="fo-faint" style={{ fontSize: 12, marginTop: 3 }}>
                Asking about {short(ask)}. He is on the market because nobody offered it.
              </div>
              <div className="fo-k" style={{ margin: '12px 0 5px' }}>Your offer · {short(offer)}</div>
              <input type="range" min={MIN_SALARY} max={Math.max(MIN_SALARY, maxSigning(team, roster))}
                step={100000} value={offer} style={{ width: '100%' }}
                onChange={(e) => setOffer(Number(e.target.value))} />
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                {[1, 2, 3].map((y) => (
                  <button key={y} type="button" className="fo-opt" aria-pressed={years === y}
                    onClick={() => setYears(y)}>{y} yr{y > 1 ? 's' : ''}</button>
                ))}
              </div>
              <div className={`fo-verdict ${verdict?.ok && willSign ? 'ok' : 'no'}`} style={{ marginTop: 12 }}>
                <div className="h fo-faint">{verdict?.ok ? (willSign ? 'He signs' : 'Not enough') : verdict?.rule}</div>
                <div className="d">
                  {!verdict?.ok ? verdict?.detail
                    : willSign ? `Signed with the ${verdict.via.label.toLowerCase()}.`
                      : `${short(ask - offer)} short of his number. He waits.`}
                </div>
                <button className="fo-btn sm" type="button" style={{ marginTop: 10 }}
                  disabled={!verdict?.ok || !willSign}
                  onClick={() => { onSign(sel, { salary: offer, years }); setSel(null) }}>
                  Sign him
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Your roster" note="waiving keeps the money">
          <div className="fo-scrollbox" style={{ maxHeight: 420 }}>
            {roster.slice().sort((a, b) => b.s - a.s).map((p, i) => (
              <div key={`${p.uid || p.n}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9,
                padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                <span className="fo-av sm">{initials(p.n)}</span>
                <span style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><PName p={p} /></span>
                <span style={{ marginLeft: 'auto', flex: 'none',
                  font: '500 11.5px/1 "IBM Plex Mono",monospace', color: 'var(--faint)' }}>{fmt(p.s)}</span>
                <button className="fo-btn ghost sm" type="button" style={{ flex: 'none' }}
                  onClick={() => onWaive(p)}>Waive</button>
              </div>
            ))}
          </div>
          {(save.deadMoney || []).length > 0 && (
            <div style={{ marginTop: 11 }}>
              <div className="fo-k" style={{ marginBottom: 5 }}>Dead money</div>
              {save.deadMoney.map((d, i) => (
                <div key={i} className="fo-row">
                  <span style={{ fontSize: 12.5 }}><PName name={d.n} /></span>
                  <span className="r"><b style={{ fontSize: 12.5 }}>{fmt(d.s)}</b></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// `focus` is a uid the desk should open on — the man whose agent has just called. It seeds
// both the block and the outgoing side of the builder, because "move him" that only changes
// which screen you are looking at is a button telling the user something untrue.
function TradeScreen({ save, onExecute, onStance, onShopped, needs, focus }) {
  const mine = save.franchise.team
  const stance = readStance(save)
  const myRoster = rosterOf(save)
  const year = parseInt(SEED.season, 10)
  const ranks = useMemo(() => strengthRanks(null), [])
  // Ownership is rebuilt against the current ranks, because a protection or a swap is
  // answered by the standings — a pick you own today can belong to somebody else after a
  // ten-game losing streak, and the desk should say so before you trade it.
  const ledger = useMemo(
    () => rebuildLedger(save.picks || newPickLedger(SEED.season), ranks),
    [save.picks, ranks])

  const partners = useMemo(() => Object.keys(SEED.teams).filter((t) => t !== mine)
    .map((t) => { const st = status(teamSalary(rostersOf(t))); return { t, ...st } })
    .sort((a, b) => b.space - a.space || a.t.localeCompare(b.t)), [mine])

  const [other, setOther] = useState(partners[0].t)
  const [outSel, setOutSel] = useState(() => {
    if (!focus) return []
    const i = (rosterOf(save) || []).findIndex((p) => (p.uid || p.n) === focus)
    return i >= 0 ? [i] : []
  })
  const [inSel, setInSel] = useState([])
  const [outPicks, setOutPicks] = useState([])
  const [inPicks, setInPicks] = useState([])
  const theirRoster = rostersOf(other)
  // Second-rounders are tradeable. They were filtered out here for a long time, which
  // quietly removed the most common sweetener in the league from the desk entirely.
  const myPicks = ownedBy(ledger, mine).filter((p) => !p.forfeit)
  const theirPicks = ownedBy(ledger, other).filter((p) => !p.forfeit)

  const outSal = outSel.map((i) => myRoster[i]).filter(Boolean).reduce((s, p) => s + p.s, 0)
  const inSal = inSel.map((i) => theirRoster[i]).filter(Boolean).reduce((s, p) => s + p.s, 0)
  const myStatus = status(teamSalary(myRoster))
  const theirStatus = status(teamSalary(theirRoster))

  // Marking what fits turns a wall into a puzzle: two apron teams both match at 100%, so
  // clicking blindly otherwise just produces "Rejected" over and over.
  const legalWith = (mo, to) => {
    if (!mo && !to) return null
    const a = myStatus.underCap && to - mo <= myStatus.space ? true : to <= maxIncoming(mo, myStatus)
    const b = theirStatus.underCap && mo - to <= theirStatus.space ? true : mo <= maxIncoming(to, theirStatus)
    return a && b
  }
  const toggle = (arr, set, k) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k])
  const clear = () => { setOutSel([]); setInSel([]); setOutPicks([]); setInPicks([]); setWork(null) }
  const [work, setWork] = useState(null)
  const [shop, setShop] = useState(null)
  // The block is a PACKAGE. Two contracts and a first is a different question from either
  // piece alone — it is how salary gets matched and how anybody acquires a star — and the
  // finder used to only be able to ask about one player at a time.
  const [blockIds, setBlockIds] = useState(() => {
    if (focus) return [focus]
    const p = [...(myRoster || [])].sort((a, b) => b.s - a.s)[0]
    return p ? [p.uid || p.n] : []
  })
  const [blockPicks, setBlockPicks] = useState([])
  const blockPlayers = myRoster.filter((p) => blockIds.includes(p.uid || p.n))
  const blockPickList = myPicks.filter((p) => blockPicks.includes(pickKey(p)))
  const blockSalary = blockPlayers.reduce((t, p) => t + p.s, 0)
  const runShop = () => {
    if (!blockPlayers.length && !blockPickList.length) return []
    return shopPackage({ players: blockPlayers, picks: blockPickList }, mine,
      { rosters: allRosters(), ledger, ranks, year, stance })
  }
  useEffect(() => { setWork(null) }, [outSel, inSel, outPicks, inPicks, other])

  const askWork = () => makeItWork(mine, other, {
    other,
    out: outSel.map((i) => myRoster[i]).filter(Boolean),
    inc: inSel.map((i) => theirRoster[i]).filter(Boolean),
    outPicks: myPicks.filter((p) => outPicks.includes(pickKey(p))),
    inPicks: theirPicks.filter((p) => inPicks.includes(pickKey(p))),
  }, { rosters: allRosters(), ledger, ranks, year, history: save.tradeHistory, stance })

  // Load a counter straight into the selection, so "do it" means what it says.
  const applyCounter = (c) => {
    const names = new Set(c.deal.out.map((p) => p.uid || p.n))
    setOutSel(myRoster.map((p, i) => (names.has(p.uid || p.n) ? i : -1)).filter((i) => i >= 0))
    const back = new Set(c.deal.inc.map((p) => p.uid || p.n))
    setInSel(theirRoster.map((p, i) => (back.has(p.uid || p.n) ? i : -1)).filter((i) => i >= 0))
    setOutPicks(c.deal.outPicks.map(pickKey))
    setInPicks((c.deal.inPicks || []).map(pickKey))
    setWork(null)
  }

  const result = useMemo(() => {
    const out = outSel.map((i) => myRoster[i]).filter(Boolean)
    const inc = inSel.map((i) => theirRoster[i]).filter(Boolean)
    const pOut = myPicks.filter((p) => outPicks.includes(pickKey(p)))
    const pIn = theirPicks.filter((p) => inPicks.includes(pickKey(p)))
    if (!out.length && !inc.length && !pOut.length && !pIn.length) return null

    for (const [team, isMine] of [[mine, true], [other, false]]) {
      const owned = (isMine ? myPicks : theirPicks)
        .filter((p) => !(isMine ? pOut : pIn).some((x) => pickKey(x) === pickKey(p)))
      const st2 = violatesStepien([...owned, ...(isMine ? pIn : pOut)], team, year)
      if (!st2.ok) return { ok: false, rule: 'Stepien rule',
        detail: `${team} would hold no first-round pick in ${st2.years[0]} or ${st2.years[1]}. A team cannot be without a first in consecutive future drafts.` }
    }
    const cap = validateTrade([
      { team: mine, roster: myRoster, out, inc },
      { team: other, roster: theirRoster, out: inc, inc: out },
    ])
    if (!cap.ok) return cap
    // What the other front office says. Their answer is not the mirror image of a single
    // number: value, what it is worth to them, and whether they will actually do it are
    // three different questions, answered in three different places.
    const theirs = decideTrade(other, { in: out, out: inc, inPicks: pOut, outPicks: pIn },
      { from: mine, roster: theirRoster, ranks, year, ledger, history: save.tradeHistory })
    const ours = decideTrade(mine, { in: inc, out, inPicks: pIn, outPicks: pOut },
      { from: other, roster: myRoster, ranks, year, ledger })
    return { ...cap, deal: { out, inc, pOut, pIn }, ai: theirs, us: ours }
  }, [outSel, inSel, outPicks, inPicks, mine, other, myRoster, theirRoster, myPicks, theirPicks, ranks, year, ledger, save])

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Trade desk</h2>
        <p>Salary matching, the apron restrictions, the Stepien rule and the other team&apos;s
          willingness are all checked as you click. A rejection always names the rule.</p>
        {needs && <NeedsRow needs={needs} />}
      </div>

      {/* What you have told the league you are doing. Every front office knows by January
          which side of the line you are on, and it decides who they call about. */}
      <div className="fo-stance">
        <span className="fo-k">Around the league you are</span>
        <div className="fo-stanceset" role="group" aria-label="Trade stance">
          {STANCES.map((k) => (
            <button key={k} type="button"
              className={`fo-stancebtn${stance === k ? ' on' : ''}`}
              aria-pressed={stance === k}
              onClick={() => onStance && onStance(k)}>{STANCE_LABEL[k]}</button>
          ))}
        </div>
        <span className="fo-stancesay">{STANCE_BLURB[stance]}</span>
        <Tip tip="A stance changes WHO they ask for, never what they pay. Declaring yourself a buyer does not make your young players cheaper — it makes them the ones teams reach for. That is the whole trade-off.">
          <span className="fo-k">what does this do?</span>
        </Tip>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="fo-k">Trading with</span>
        <select className="fo-sel" value={other}
          onChange={(e) => { setOther(e.target.value); setInSel([]); setInPicks([]) }}>
          {partners.map((p) => (
            <option key={p.t} value={p.t}>
              {p.t} — {CITY[p.t][1]} · {p.space > 0 ? `${short(p.space)} room` : statusLabel(p)}
            </option>
          ))}
        </select>
        <Tip tip="Sorted by cap room. Two teams above the first apron both match at 100%, so their salaries must line up almost exactly — a team with space is far easier to deal with.">
          <span className="fo-k">why this order?</span>
        </Tip>
        {(outSel.length + inSel.length + outPicks.length + inPicks.length > 0) &&
          <button className="fo-btn ghost sm" type="button" onClick={clear}>Clear</button>}
      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <TradeSide abbr={mine} roster={myRoster} picks={myPicks} sel={outSel} selPicks={outPicks}
          out={outSal} inn={inSal} ranks={ranks} year={year} groups={ledger.$groups}
          onT={(i) => toggle(outSel, setOutSel, i)} onTP={(k) => toggle(outPicks, setOutPicks, k)}
          fit={(p, on) => (inSal === 0 && !on ? null : legalWith(on ? outSal - p.s : outSal + p.s, inSal))} />
        <TradeSide abbr={other} roster={theirRoster} picks={theirPicks} sel={inSel} selPicks={inPicks}
          out={inSal} inn={outSal} ranks={ranks} year={year} groups={ledger.$groups}
          onT={(i) => toggle(inSel, setInSel, i)} onTP={(k) => toggle(inPicks, setInPicks, k)}
          fit={(p, on) => (outSal === 0 && !on ? null : legalWith(outSal, on ? inSal - p.s : inSal + p.s))} />
      </div>

      <div className={`fo-verdict ${!result ? '' : result.ok ? 'ok' : 'no'}`}>
        {!result ? (
          <>
            <div className="h fo-faint">No trade on the table</div>
            <div className="d">Click players or picks on either side. Anything that would fit is outlined
              in green as you go.</div>
          </>
        ) : !result.ok ? (
          <>
            <div className="h fo-bad">Rejected — {result.rule}</div>
            <div className="d">{result.detail}</div>
            <button className="fo-btn ghost" type="button" style={{ marginTop: 12 }}
              onClick={() => setWork(askWork())}>
              What would make this work?
            </button>
            {work && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                {work.counters.length ? (
                  <>
                    <div className="fo-k" style={{ marginBottom: 8 }}>This shape is legal and they would take it</div>
                    {work.counters.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                        <span style={{ fontSize: 13 }}>{c.text}</span>
                        <button className="fo-btn sm" type="button" style={{ marginLeft: 'auto' }}
                          onClick={() => applyCounter(c)}>Do it</button>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="fo-muted" style={{ fontSize: 13 }}>{work.ask}</div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="h fo-good">Legal trade
              <span style={{ marginLeft: 10,
                color: result.ai.need <= 0 ? 'var(--good)'
                  : result.ai.verdict === VERDICT.NEGOTIABLE || result.ai.verdict === VERDICT.COUNTER
                    ? 'var(--warn)' : 'var(--bad)' }}>
                · {verdictText(result.ai, other)}
              </span>
            </div>
            <div className="d">
              {result.ai.reasons.slice(0, 3).map((r, i) => (
                <div key={i} style={{ marginBottom: 3 }}>{r}</div>
              ))}
              {result.us && (
                <div style={{ marginTop: 7, color: result.us.delta > 0 ? 'var(--good)' : 'var(--bad)' }}>
                  For you: {result.us.delta > 0 ? 'a gain' : 'a loss'} of roughly {short(Math.abs(result.us.delta))}
                  {Math.abs(result.us.wins.delta) >= 0.4
                    ? ` and ${result.us.wins.delta > 0 ? '+' : ''}${result.us.wins.delta.toFixed(1)} wins this season.`
                    : '.'}
                </div>
              )}
            </div>
            <ul>{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="fo-btn" type="button"
                disabled={result.ai.need > 0}
                onClick={() => { onExecute({ other, out: result.deal.out, inc: result.deal.inc,
                  outPicks: result.deal.pOut, inPicks: result.deal.pIn }); clear() }}>
                {result.ai.need > 0 ? `${other} won’t do this` : 'Make the trade'}
              </button>
              {result.ai.need > 0 && result.ai.verdict !== VERDICT.UNTOUCHABLE && (
                <button className="fo-btn ghost" type="button" onClick={() => setWork(askWork())}>
                  What would make this work?
                </button>
              )}
            </div>
            {work && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                {work.counters.length ? (
                  <>
                    <div className="fo-k" style={{ marginBottom: 8 }}>They would say yes to</div>
                    {work.counters.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                        <span style={{ fontSize: 13 }}>{c.text}</span>
                        <button className="fo-btn sm" type="button" style={{ marginLeft: 'auto' }}
                          onClick={() => applyCounter(c)}>Do it</button>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="fo-muted" style={{ fontSize: 13 }}>{work.ask || 'Nothing you have closes the gap.'}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="Shop a package" note="What the league would give up">
          <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 11px' }}>
            Put anything on the block — one contract, three and a first, picks on their own — and
            ask all twenty-nine. Each values the package against its own position: a 34-year-old is
            worth more to a contender than to a lottery team, and a young player the other way
            round. Not everybody calls back.
          </p>
          <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', marginBottom: 11 }}>
            <div>
              <div className="fo-k" style={{ marginBottom: 6 }}>Players on the block</div>
              <div className="fo-scrollbox" style={{ maxHeight: 168 }}>
                {myRoster.map((p) => {
                  const k = p.uid || p.n
                  const on = blockIds.includes(k)
                  return (
                    <button key={k} type="button" aria-pressed={on}
                      onClick={() => { setShop(null)
                        setBlockIds(on ? blockIds.filter((x) => x !== k) : [...blockIds, k]) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '5px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                        background: on ? 'color-mix(in srgb,var(--acc) 16%,transparent)' : 'transparent',
                        border: `1px solid ${on ? 'var(--acc)' : 'transparent'}` }}>
                      <span style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><PName p={p} /></span>
                      <span style={{ marginLeft: 'auto', flex: 'none',
                        font: '500 11px/1 "IBM Plex Mono",monospace', color: 'var(--faint)' }}>{fmt(p.s)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <PickList picks={myPicks} sel={blockPicks} ranks={ranks} year={year}
                groups={ledger.$groups} compact
                onT={(k) => { setShop(null)
                  setBlockPicks(blockPicks.includes(k) ? blockPicks.filter((x) => x !== k) : [...blockPicks, k]) }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="fo-btn sm" type="button"
              disabled={!blockPlayers.length && !blockPickList.length}
              onClick={() => {
                setShop(runShop())
                // He knows. Putting a man on the block is the one trade-request trigger the
                // user causes himself, and it is the reason the story layer is not just
                // weather: shop a good player, fail to move him, and by February his agent
                // is on the phone.
                if (onShopped && blockPlayers.length) onShopped(blockPlayers)
              }}>
              {blockPlayers.length + blockPickList.length > 1
                ? `Shop these ${blockPlayers.length + blockPickList.length}` : 'Put him on the block'}
            </button>
            <span className="fo-k">
              {blockPlayers.length
                ? `${blockPlayers.length} player${blockPlayers.length === 1 ? '' : 's'} · ${short(blockSalary)}` : 'no players'}
              {blockPickList.length ? ` · ${blockPickList.length} pick${blockPickList.length === 1 ? '' : 's'}` : ''}
            </span>
            {(blockIds.length || blockPicks.length) > 0 && (
              <button className="fo-btn ghost sm" type="button"
                onClick={() => { setBlockIds([]); setBlockPicks([]); setShop(null) }}>Empty the block</button>
            )}
            {shop && <button className="fo-btn ghost sm" type="button" onClick={() => setShop(null)}>Clear results</button>}
          </div>

          {shop && (
            <div style={{ marginTop: 13 }}>
              {(() => {
                const withOffers = shop.filter((r) => r.offers.length)
                if (!withOffers.length) {
                  return (
                    <div className="fo-empty">
                      No offers. {shop.filter((r) => r.note && r.note.startsWith('no interest')).length} teams
                      have no interest at all — the rest like him but will not part with anything that fits.
                    </div>
                  )
                }
                return (
                  <>
                    {withOffers.slice(0, 6).map((r) => r.offers.map((o, i) => (
                      <div key={r.team + i} style={{ display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                        <span className="fo-av sm" style={{ background: CLUB[r.team]?.[0], color: clubInk(r.team) }}>
                          {r.team}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13 }}>
                            {o.deal.inc.map((pl, k) => (
                              <span key={pl.uid || pl.n}>
                                {k ? ' + ' : ''}
                                <PName p={pl} />
                              </span>
                            ))}
                            {(o.deal.inPicks || []).length
                              ? `${o.deal.inc.length ? ' + ' : ''}${(o.deal.inPicks || [])
                                .map((k) => pickLabel(k, ranks[k.from])).join(' + ')}`
                              : ''}
                          </span>
                          <span className="fo-k" style={{ display: 'block', marginTop: 4 }}>
                            {o.flavour} · {r.ctx.label}
                          </span>
                        </span>
                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5,
                          color: o.mine.delta > 0 ? 'var(--good)' : 'var(--faint)' }}>
                          {o.mine.delta > 0 ? '+' : ''}{short(o.mine.delta)}
                        </span>
                        <button className="fo-btn sm" type="button"
                          onClick={() => { onExecute({ other: r.team, out: o.deal.out, inc: o.deal.inc,
                            outPicks: o.deal.outPicks || [], inPicks: o.deal.inPicks || [] }); setShop(null) }}>
                          Take it
                        </button>
                      </div>
                    )))}
                    <div className="fo-k" style={{ marginTop: 11 }}>
                      {withOffers.length} of 29 teams made an offer ·{' '}
                      {shop.filter((r) => r.note && r.note.startsWith('no interest')).length} not interested
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ season */

function Bar({ pct, color = 'var(--acc)' }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: '#171C27', overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color,
        borderRadius: 3, transition: 'width .35s ease' }} />
    </div>
  )
}

function StandingsTable({ tab, mine, conf }) {
  return (
    <Card title={conf} note="Seeds 1–10 make the play-in field" flush>
      <div style={{ maxHeight: 430, overflow: 'auto' }}>
        <table className="fo-tbl" style={{ minWidth: 380 }}>
          <thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>DIFF</th></tr></thead>
          <tbody>
            {tab[conf].map((r, i) => (
              <tr key={r.team} style={{
                background: r.team === mine ? 'color-mix(in srgb,var(--acc) 13%,transparent)' : undefined,
                opacity: i > 9 ? 0.55 : 1 }}>
                <td>
                  <span className="fo-faint mono" style={{ fontSize: 11, marginRight: 8 }}>{i + 1}</span>
                  {CITY[r.team][1]}
                  {i === 5 && (
                    <Tip tip="Seeds 1–6 go straight to the playoffs. Seeds 7–10 play in for the last two spots: 7 hosts 8 for the seventh seed, 9 hosts 10 to survive, and the two losers meet for the eighth.">
                      <span className="fo-tag">playoff line</span>
                    </Tip>
                  )}
                  {i === 9 && (
                    <Tip tip="Eleventh and below is the lottery. Nothing after this row plays another game.">
                      <span className="fo-tag">play-in line</span>
                    </Tip>
                  )}
                </td>
                <td className="n">{r.w}</td>
                <td className="n">{r.l}</td>
                <td className="n">{r.gp ? (r.pct === 1 ? '1.000' : r.pct.toFixed(3).slice(1)) : '—'}</td>
                <td className="n" style={{ color: r.diff > 0 ? 'var(--good)' : r.diff < 0 ? 'var(--bad)' : 'inherit' }}>
                  {r.gp ? (r.diff > 0 ? '+' : '') + r.diff.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function DeadlineInbox({ offers, mine, onAccept, onPass }) {
  const ranks = useMemo(() => strengthRanks(null), [])
  const year = parseInt(SEED.season, 10)
  if (!offers) return null
  return (
    <Card title="The phone is ringing" note={`Trade deadline · ${offers.length} calls`}>
      <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Every one of these is already cap-legal for both sides. What is up to you is whether it is
        a good deal — the margin is in the same currency the trade desk uses.
      </p>
      {!offers.length && <div className="fo-empty">Nobody called. The season resumes.</div>}
      {offers.map((o) => {
        const m = offerMargin(o, ranks, year)
        return (
          <div key={o.id} style={{ border: '1px solid var(--line)', borderRadius: 6,
            padding: 12, marginBottom: 10, background: 'var(--panel-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
              <span className="fo-av sm" style={{ background: CLUB[o.team]?.[0], color: clubInk(o.team) }}>{o.team}</span>
              <span style={{ fontSize: 13.5 }}>{o.pitch}</span>
              <Tip right tip="Positive means the package you get back is worth more than the player you send. Value is projected surplus over the life of every contract, plus pick value.">
                <span className="fo-k" style={{ marginLeft: 'auto',
                  color: m > 0 ? 'var(--good)' : 'var(--bad)' }}>{m > 0 ? '+' : ''}{short(m)}</span>
              </Tip>
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              <div>out → <PName p={o.want} /> <span className="fo-faint">({fmt(o.want.s)})</span></div>
              <div>in ← {o.give.map((p, gi) => (
                <span key={p.uid || p.n}>{gi ? ' · ' : ''}<PName p={p} /> <span className="fo-faint">({short(p.s)})</span></span>
              ))}
                {o.givePicks.length ? ` · ${o.givePicks.map((p) => pickLabel(p, ranks[p.from])).join(' · ')}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
              <button className="fo-btn sm" type="button" onClick={() => onAccept(o)}>Accept</button>
              <button className="fo-btn ghost sm" type="button" onClick={() => onPass(o)}>Pass</button>
            </div>
          </div>
        )
      })}
      <button className="fo-btn ghost sm" type="button" onClick={() => onPass(null)}
        style={{ marginTop: 4 }}>Close the desk and play on</button>
    </Card>
  )
}

function PlayoffBracket({ po, mine }) {
  const rounds = ['First round', 'Conference semifinal', 'Conference final', 'NBA Finals']
  return (
    <Card title="Postseason" note={`${CITY[po.champion][1]} win the title`}>
      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
        {rounds.map((rn) => (
          <div key={rn}>
            <div className="fo-k" style={{ marginBottom: 8 }}>{rn}</div>
            {po.rounds.filter((r) => r.name === rn).map((r, i) => {
              const involved = r.hi === mine || r.lo === mine
              return (
                <div key={i} style={{ padding: '7px 9px', marginBottom: 5, borderRadius: 5,
                  border: `1px solid ${involved ? 'var(--acc)' : 'var(--line)'}`,
                  background: involved ? 'color-mix(in srgb,var(--acc) 10%,transparent)' : 'var(--panel-2)',
                  font: '500 12px/1.5 "IBM Plex Mono",monospace' }}>
                  <div style={{ color: r.winner === r.hi ? 'var(--ink)' : 'var(--faint)' }}>
                    {r.hi} <span style={{ float: 'right' }}>{r.w[r.hi]}</span></div>
                  <div style={{ color: r.winner === r.lo ? 'var(--ink)' : 'var(--faint)' }}>
                    {r.lo} <span style={{ float: 'right' }}>{r.w[r.lo]}</span></div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------- chapters */

// The card that turns the page. A phase change used to be a silent state write and the
// screen simply became a different screen; a year in a front office has chapters, and each
// one closing should be announced with what it produced and what the next one asks for.
// A ballot row carries the whole cap sheet and the whole simulation profile, which is far
// more than a screen needs and far more than belongs in a save file. Keep the sentence.
const slimAward = (r) => r && ({
  id: r.id, name: r.name, team: r.team, share: r.share ?? 0,
  pts: r.pts, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, wins: r.wins, g: r.g,
})
const packAwards = (a) => ({
  list: a.list.map((x) => ({ key: x.key, name: x.name, winner: slimAward(x.winner),
    ballot: x.ballot.map(slimAward) })),
  allNba: a.allNba.map((t) => t.map(slimAward)),
  allDef: a.allDef.map((t) => t.map(slimAward)),
  allRookie: a.allRookie.map((t) => t.map(slimAward)),
})

// AWARD SEASON.
//
// The end of a regular season used to be a line in the ticker — "Regular season complete" —
// and then the bracket. Eighty-two games of somebody averaging thirty-one and thirteen went
// unremarked, which is a strange thing for a game about running a basketball team to do.
//
// So the votes are counted and read out one at a time, because an awards show that puts
// everything on one screen is a table and not a ceremony. Your own players get the room:
// the card turns gold, it says which club he plays for, and it does not move on until you
// tell it to.
// The trophy. Drawn rather than fetched, because the page has to be one self-contained file
// and because the real ones belong to the people whose names are on them. A plinth, a
// tapering column and a ball: the shape a trophy has, in this game's own metal.
function Trophy({ tone = 'gold' }) {
  const a = tone === 'gold' ? '#E8C56A' : '#9FB3D0'
  const dark = tone === 'gold' ? '#7A5D1E' : '#4A5C77'
  return (
    <svg className="aw-trophy" viewBox="0 0 120 190" aria-hidden="true">
      <defs>
        <linearGradient id="awm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="48%" stopColor={dark} />
          <stop offset="100%" stopColor={a} />
        </linearGradient>
        <radialGradient id="awb" cx="35%" cy="30%">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      {/* plinth */}
      <rect x="18" y="158" width="84" height="10" rx="2" fill="url(#awm)" opacity="0.85" />
      <rect x="26" y="132" width="68" height="26" rx="2" fill="url(#awm)" opacity="0.55" />
      <rect x="34" y="141" width="52" height="3" rx="1.5" fill={a} opacity="0.5" />
      {/* column */}
      <path d="M46 132 L52 74 L68 74 L74 132 Z" fill="url(#awm)" />
      <path d="M52 74 L60 74 L57 132 L46 132 Z" fill={dark} opacity="0.45" />
      {/* ball */}
      <circle cx="60" cy="50" r="26" fill="url(#awb)" />
      <path d="M34 50 h52 M60 24 v52 M40 32 q20 18 0 36 M80 32 q-20 18 0 36"
        fill="none" stroke={dark} strokeWidth="1.6" opacity="0.75" />
    </svg>
  )
}

// A half-court in thin lines, behind the presentation. It is the only decoration on the
// screen and it is there to make the moment feel staged rather than tabulated.
const CourtPlate = () => (
  <svg className="aw-court" viewBox="0 0 400 260" aria-hidden="true" preserveAspectRatio="none">
    <g fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="12" y="12" width="376" height="236" />
      <path d="M150 12 h100 v76 h-100 Z" />
      <circle cx="200" cy="88" r="34" />
      <circle cx="200" cy="30" r="6" />
      <path d="M40 12 v58 a160 160 0 0 0 320 0 v-58" strokeDasharray="5 5" />
      <path d="M12 248 h376" />
    </g>
  </svg>
)

// AWARD SEASON.
//
// The end of a regular season used to be a line in the ticker — "Regular season complete" —
// and then the bracket. Eighty-two games of somebody averaging thirty-one and thirteen went
// unremarked, which is a strange thing for a game about running a basketball team to do.
//
// The presentation is modelled on the one every basketball game player already knows: a wide
// stage with the winner named across it, the trophy standing in the middle, the award and
// what it is for explained down the right-hand side, and the season's line laid out in
// columns along the bottom. One award at a time, arrows to page through the men who finished
// behind him, and no way to see everything at once — because a ceremony that puts everything
// on one screen is a table.
//
// Your own players take the room in gold and the card says so out loud.
function AwardsNight({ awards, mine, onDone }) {
  const cards = useMemo(() => {
    const out = []
    for (const a of awards.list) {
      out.push({ kind: 'award', key: a.key, title: a.name, blurb: AWARD_BLURB[a.key],
        winner: a.winner, ballot: a.ballot })
    }
    const team = (label, tiers, names, blurb) => (tiers || []).forEach((tm, i2) => {
      if (tm && tm.length) {
        out.push({ kind: 'team', key: `${label}${i2}`, title: `${names[i2]} ${label}`,
          blurb, five: tm })
      }
    })
    team('All-NBA', awards.allNba, ['First Team', 'Second Team', 'Third Team'],
      'The fifteen best players in the league this season, in three teams of five — two guards, two forwards and a centre, the way the ballot has always been shaped.')
    team('All-Defensive', awards.allDef, ['First Team', 'Second Team'],
      'The ten best defenders in the league, judged on stops rather than on stops per possession — blocks, steals, and the shots that were never taken.')
    team('All-Rookie', awards.allRookie, ['First Team', 'Second Team'],
      'The ten best first-year players in the league. Eligibility is the season, not the age: a man in his first year, however old he is.')
    return out
  }, [awards])

  const [i, setI] = useState(0)
  const [seat, setSeat] = useState(0)
  useEffect(() => { setSeat(0) }, [i])
  const c = cards[i]
  if (!c) return null
  const last = i >= cards.length - 1
  const roll = c.kind === 'award' ? c.ballot : c.five
  const who = roll[Math.min(seat, roll.length - 1)] || roll[0]
  const isYours = c.kind === 'award' ? c.winner?.team === mine : c.five.some((r) => r.team === mine)
  const mineNow = who?.team === mine
  const next = () => (last ? onDone() : setI((x) => x + 1))
  const page = (d) => setSeat((x) => Math.max(0, Math.min(roll.length - 1, x + d)))
  const club = CLUB[who?.team] || []

  const line = who ? [
    ['PTS', who.pts?.toFixed(1)], ['REB', who.reb?.toFixed(1)], ['AST', who.ast?.toFixed(1)],
    ['STL', who.stl?.toFixed(1)], ['BLK', who.blk?.toFixed(1)],
    ['W', who.wins], ['L', typeof who.wins === 'number' ? 82 - who.wins : null],
    ['GP', who.g],
  ].filter(([, v]) => v !== null && v !== undefined) : []

  const first = String(who?.name || '').split(' ')[0]
  const rest = String(who?.name || '').split(' ').slice(1).join(' ')

  return (
    <div className="fo-cast fo-awards" role="dialog" aria-modal="true">
      <div className={`aw${isYours ? ' yours' : ''}`}>
        <div className="aw-top">
          <span className="ck">Award season · {i + 1} of {cards.length}</span>
          {who?.team && (
            <span className="aw-club">
              <b>Current team</b>
              <span>{(CITY[who.team] || [])[1] || who.team}</span>
            </span>
          )}
          {c.kind === 'award' && (
            <span className="aw-rank">
              {seat === 0 ? 'Winner' : `${seat + 1}${['st', 'nd', 'rd'][seat] || 'th'} in the voting`}
              <b>{Math.round((who?.share ?? 0) * 100)}% of the vote</b>
            </span>
          )}
        </div>

        <div className="aw-stage">
          <div className="aw-show" style={{ '--club': club[0] || 'var(--acc)' }}>
            <CourtPlate />
            {roll.length > 1 && (
              <>
                <button className="aw-arrow l" type="button" aria-label="Previous"
                  disabled={seat === 0} onClick={() => page(-1)}>‹</button>
                <button className="aw-arrow r" type="button" aria-label="Next"
                  disabled={seat >= roll.length - 1} onClick={() => page(1)}>›</button>
              </>
            )}
            <Trophy tone={mineNow ? 'gold' : 'silver'} />
            <div className="aw-name">
              <span className="ab" style={{ background: club[0], color: clubInk(who?.team) }}>
                {who?.team}
              </span>
              <span className="fn">{first}</span>
              <span className="ln"><PName name={who?.name}>{rest || first}</PName></span>
              {mineNow && <span className="mine">Your player</span>}
            </div>
          </div>

          <div className="aw-side">
            <div className="aw-mark">Front Office<i>Season Honours</i></div>
            <h3>{c.title}</h3>
            <p>{c.blurb}</p>
            {c.kind === 'team' && (
              <ol className="aw-five">
                {c.five.map((r, n) => (
                  <li key={r.id} className={(n === seat ? 'on' : '') + (r.team === mine ? ' own' : '')}>
                    <button type="button" onClick={() => setSeat(n)}>
                      <span className="t">{r.team}</span>{r.name}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="aw-line">
          {line.map(([k, val]) => (
            <div key={k} className="cell"><span className="k">{k}</span><b>{val}</b></div>
          ))}
        </div>

        <div className="aw-foot">
          <button className="fo-btn" type="button" onClick={next}>
            {last ? 'On to the bracket' : 'Next award'}
          </button>
          {!last && <button className="fo-btn ghost sm" type="button" onClick={onDone}>Skip the rest</button>}
          <span className="hint">
            {roll.length > 1 ? 'Arrows page through the rest of the ballot.' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// What each award is actually for, in the language a broadcast uses. Written out because the
// name alone does not tell a new player why Sixth Man is a separate thing from Most Improved.
const AWARD_BLURB = {
  mvp: 'Awarded to the best performing player of the regular season. Production counts, and so does what the team did with it — this has always been an award that goes to a very good player on a very good team.',
  dpoy: 'Awarded to the league’s best defensive player, on stops, rim protection and the shots that were never attempted. It has always leaned toward the men in the middle.',
  roy: 'Awarded to the best player in his first professional season. Age has nothing to do with it — a twenty-three-year-old in year one is as eligible as a nineteen-year-old.',
  smoy: 'Awarded to the best player coming off the bench. He has to actually come off it: most of his games, and a bench player’s minutes.',
  mip: 'Awarded to the player who improved most on what he was. It rewards the size of the jump, which is why it so often goes to somebody nobody had heard of a year ago.',
}

// THE CUP.
//
// Four group games in November that also count in the standings, six groups, six winners and
// a wild card from each conference, then single elimination — the quarter-finals at home and
// everything after that in Las Vegas. It is a real tournament with real rules and it deserves
// to look like one rather than being four fixtures with a different border.
function CupGroups({ season, mine }) {
  const tables = useMemo(
    () => (season.cupGroups || []).map((g) => groupTable(g, season.cupResults || [])),
    [season.cupGroups, season.cupResults])
  const played = season.cupResults?.length ?? 0
  return (
    <Card title={CUP_NAME} note={`${played} of 60 group games`}>
      <p className="fo-muted" style={{ fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.5 }}>
        Four group games, all of which also count in the standings. Six group winners and one
        wild card from each conference go through; the quarter-finals are in the higher seed’s
        building and the rest is in Las Vegas.
      </p>
      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        {tables.map((t) => (
          <div key={t.id} className={`fo-cupgrp${t.rows.some((r) => r.team === mine) ? ' mine' : ''}`}>
            <div className="h">{t.id} <i>{t.conf}</i></div>
            {t.rows.map((r, i) => (
              <div key={r.team} className={`r${r.team === mine ? ' own' : ''}${i === 0 ? ' top' : ''}`}>
                <span className="t">{r.team}</span>
                <span className="w">{r.w}–{r.l}</span>
                <span className="d">{r.diff > 0 ? '+' : ''}{r.diff}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}

// The bracket, and the one decision at the end of it.
function CupNight({ season, kn, mine, onPlay, onBanner, onClose }) {
  const stage = kn.stage
  const meta = CUP_ROUNDS_META.find((r) => r.key === stage)
  const done = kn.ties.filter((t) => t.winner)
  const live = kn.ties.filter((t) => t.round === stage && !t.winner)
  const iAmIn = kn.ties.some((t) => (t.hi === mine || t.lo === mine) && t.round === stage && !t.winner)
  const iWon = kn.champion === mine
  const out = kn.ties.some((t) => t.loser === mine)

  return (
    <div className="fo-cast fo-awards" role="dialog" aria-modal="true">
      <div className={`aw cup${iWon ? ' yours' : ''}`}>
        <div className="aw-top">
          <span className="ck">{CUP_NAME} · {stage === 'done' ? 'Champion' : cupRoundName(stage)}</span>
          {meta && <span className="aw-rank">{meta.where}<b>{meta.counts ? 'Counts in the standings' : 'Does not count'}</b></span>}
        </div>

        <div className="aw-stage">
          <div className="aw-show" style={{ '--club': (CLUB[iWon ? mine : (live[0]?.hi || mine)] || [])[0] || 'var(--acc)' }}>
            <CourtPlate />
            <Trophy tone={iWon ? 'gold' : 'silver'} />
            <div className="aw-name">
              {stage === 'done' ? (
                <>
                  <span className="fn">{CUP_NAME} champions</span>
                  <span className="ln">{(CITY[kn.champion] || [])[1] || kn.champion}</span>
                  {iWon && <span className="mine">You won it</span>}
                </>
              ) : (
                <>
                  <span className="fn">{cupRoundName(stage)}</span>
                  <span className="ln">{live.length} {live.length === 1 ? 'tie' : 'ties'}</span>
                  {iAmIn && <span className="mine">You are in it</span>}
                </>
              )}
            </div>
          </div>

          <div className="aw-side">
            <div className="aw-mark">{CUP_NAME}<i>In-season tournament</i></div>
            <h3>{stage === 'done' ? 'It is over' : cupRoundName(stage)}</h3>
            <ol className="cup-ties">
              {kn.ties.map((t, i) => (
                <li key={`${t.round}${i}`} className={`${t.round === stage ? 'on' : ''}`
                  + `${t.hi === mine || t.lo === mine ? ' own' : ''}`}>
                  <span className="rd">{cupRoundName(t.round).replace('The ', '')}</span>
                  <span className="tm">
                    <b className={t.winner === t.hi ? 'w' : ''}>{t.hi}</b> v{' '}
                    <b className={t.winner === t.lo ? 'w' : ''}>{t.lo}</b>
                  </span>
                  <span className="sc">{t.winner ? `${Math.max(t.hs, t.as)}–${Math.min(t.hs, t.as)}` : '—'}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="aw-foot">
          {stage !== 'done' ? (
            <button className="fo-btn" type="button" onClick={onPlay}>
              Play the {cupRoundName(stage).toLowerCase()}
            </button>
          ) : iWon ? (
            <>
              <button className="fo-btn" type="button" onClick={() => onBanner(true)}>
                Raise the banner
              </button>
              <button className="fo-btn ghost" type="button" onClick={() => onBanner(false)}>
                Save it for something bigger
              </button>
            </>
          ) : (
            <button className="fo-btn" type="button" onClick={onClose}>
              {out ? 'Back to the season' : 'Close'}
            </button>
          )}
          <span className="hint">
            {stage === 'done' && iWon
              ? `A banner is +${Math.round(CUP_BOOST.pct * 100)}% for ${CUP_BOOST.days} days. `
                + `Decline and a bigger one later is +${Math.round(DEFERRED_BOOST.pct * 100)}% for ${DEFERRED_BOOST.days}.`
              : done.length ? `${done.length} played` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// A SWEEPING BAR AND ONE INPUT.
//
// Both contests come down to the same thing — a marker crosses a strip and you stop it — and
// building it once means the shootout and the dunk contest feel like the same weekend rather
// than two different games. The bar is the only mechanical skill in Front Office and it is
// deliberately the only one: this is a management game, and the weekend is a break from it.
//
// The timer is an interval and not requestAnimationFrame, because the headless play-through
// mounts this in a DOM with no compositor and rAF never fires there — a test that hangs on a
// minigame is worse than a minigame that runs at fifty frames a second.
function TimingBar({ speed = 1, running, onStop, label = 'Stop it in the green' }) {
  const [pos, setPos] = useState(0)
  const dir = useRef(1)
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => {
      setPos((x) => {
        let n = x + dir.current * 0.028 * speed
        if (n >= 1) { n = 1; dir.current = -1 }
        if (n <= 0) { n = 0; dir.current = 1 }
        return n
      })
    }, 16)
    return () => clearInterval(id)
  }, [running, speed])
  // Accuracy is how close to the middle it stopped, on nought to one.
  const stop = () => onStop(1 - Math.abs(pos - 0.5) * 2, pos)
  return (
    <div className="as-bar">
      <div className="track">
        <span className="zone wide" />
        <span className="zone tight" />
        <span className="mark" style={{ left: `${pos * 100}%` }} />
      </div>
      <button className="fo-btn" type="button" disabled={!running} onClick={stop}>{label}</button>
    </div>
  )
}

// THE THREE-POINT SHOOTOUT. Five racks of five, four ordinary balls and a money ball, and the
// last rack all money. Where the ball goes is the shooter's own three-point rating; the timing
// bar is worth about a quarter of the result, which is enough to feel like you shot it and not
// enough to make a 38% shooter beat Stephen Curry.
function ThreeContest({ me, cpu, onDone }) {
  const [shots, setShots] = useState([])
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const r = useRef(rng(seed)).current
  const base = makeRate(me)
  const i = shots.length
  const rack = Math.floor(i / BALLS)
  const ball = i % BALLS
  const money = rack === RACKS - 1 || ball === BALLS - 1
  const done = i >= RACKS * BALLS
  const total = shots.reduce((s2, x) => s2 + (x.made ? x.worth : 0), 0)

  const take = (acc) => {
    const p = Math.max(0.12, Math.min(0.95, base * (0.74 + acc * 0.5)))
    setShots((prev) => [...prev, { made: r.rand() < p, worth: money ? 2 : 1, acc }])
  }
  const board = useMemo(() => [...cpu.filter((c) => c.who.id !== me.id),
    { who: me, total, mine: true }].sort((a, b) => b.total - a.total), [cpu, me, total])

  return (
    <>
      <div className="as-head">
        <span className="ck">{me.n} · three-point shootout</span>
        <b>{total}</b>
        <i>of {MAX_THREE}</i>
      </div>
      <div className="as-racks">
        {Array.from({ length: RACKS }, (_, ri) => (
          <div key={ri} className={`rack${ri === rack && !done ? ' on' : ''}${ri === RACKS - 1 ? ' money' : ''}`}>
            {Array.from({ length: BALLS }, (_, bi) => {
              const sh = shots[ri * BALLS + bi]
              const isMoney = ri === RACKS - 1 || bi === BALLS - 1
              return <span key={bi} className={`b${isMoney ? ' m' : ''}${sh ? (sh.made ? ' made' : ' miss') : ''}`} />
            })}
          </div>
        ))}
      </div>
      {!done ? (
        <TimingBar running speed={1.15} onStop={take}
          label={money ? 'Money ball' : `Rack ${rack + 1}, ball ${ball + 1}`} />
      ) : (
        <>
          <ol className="as-board">
            {board.map((row) => (
              <li key={row.who.id} className={row.mine ? 'own' : ''}>
                <span className="t">{row.who.team}</span>
                <span className="nm">{row.who.n}</span>
                <span className="sc">{row.total}</span>
              </li>
            ))}
          </ol>
          <button className="fo-btn" type="button"
            onClick={() => onDone({ total, won: board[0]?.mine === true })}>
            {board[0]?.mine ? 'You won it' : 'Back to the weekend'}
          </button>
        </>
      )}
    </>
  )
}

// THE DUNK CONTEST. Two dunks, and the whole game is the choice: the harder it is the more it
// is worth and the less often it lands. Judges score out of fifty.
function DunkContest({ me, cpu, onDone }) {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9))
  const r = useRef(rng(seed)).current
  const [picked, setPicked] = useState(null)
  const [rounds, setRounds] = useState([])
  const hops = Math.max(0, Math.min(1, (((me.cap.rpr ?? 50) + (me.cap.sz ?? 50) * 0.3) - 40) / 55))
  const total = rounds.reduce((s2, x) => s2 + x.score, 0)
  const done = rounds.length >= 2

  const attempt = (acc) => {
    // The bar decides whether he lands it, and the difficulty decides how forgiving the bar is.
    const need = needFor(picked)
    const clean = acc >= need
    setRounds((prev) => [...prev, { dunk: picked, clean, score: judge(picked, clean, hops, r) }])
    setPicked(null)
  }
  const board = useMemo(() => [...cpu.filter((c) => c.who.id !== me.id)
    .map((c) => ({ ...c, total: c.score * 2 })), { who: me, total, mine: true }]
    .sort((a, b) => b.total - a.total), [cpu, me, total])

  return (
    <>
      <div className="as-head">
        <span className="ck">{me.n} · dunk {Math.min(2, rounds.length + 1)} of 2</span>
        <b>{total}</b>
        <i>of 100</i>
      </div>
      {rounds.length > 0 && (
        <ul className="as-done">
          {rounds.map((x, n) => (
            <li key={n}><b>{x.score}</b> {x.dunk.name} <i>{x.clean ? 'clean' : 'off the back rim'}</i></li>
          ))}
        </ul>
      )}
      {!done ? (picked ? (
        <TimingBar running speed={1 + picked.tough} onStop={attempt} label="Go up" />
      ) : (
        <div className="as-pick">
          {DUNKS.map((d) => (
            <button key={d.key} type="button" className="fo-btn ghost" onClick={() => setPicked(d)}>
              <b>{d.name}</b>
              <i>worth up to {d.ceiling} · you land it about {Math.round((1 - needFor(d)) * 100)}% of the time</i>
            </button>
          ))}
        </div>
      )) : (
        <>
          <ol className="as-board">
            {board.map((row) => (
              <li key={row.who.id} className={row.mine ? 'own' : ''}>
                <span className="t">{row.who.team}</span>
                <span className="nm">{row.who.n}</span>
                <span className="sc">{row.total}</span>
              </li>
            ))}
          </ol>
          <button className="fo-btn" type="button"
            onClick={() => onDone({ total, won: board[0]?.mine === true })}>
            {board[0]?.mine ? 'You won it' : 'Back to the weekend'}
          </button>
        </>
      )}
    </>
  )
}

// A MAN ON YOUR OWN ROSTER ASKS TO LEAVE.
//
// This is the only thing in the game that happens TO the user rather than because of him, and
// the only one he can answer wrong. Three doors: move him, sit down with him, or say no.
//
// Saying no has to cost something or the request is a notification with a button on it. It
// costs production for the rest of the year — not a sulk, a professional who has stopped
// volunteering for the hard minutes — and he asks again in the summer, by which time
// "shopped and not moved" is also true of him and the request comes back louder.
function TradeRequest({ ask, player, save, mine, talkOdds, onTrade, onTalk, onRefuse }) {
  const club = (CITY[mine] || [])[1] || mine
  const why = ask.sit.why
  const line = {
    window: `He is ${Math.floor(player?.a ?? 30)}, and he does not think ${club} are going anywhere while he can still play.`,
    role: `He is playing ${(player?.mpg ?? 0).toFixed(1)} a night and thinks he is better than that.`,
    shopped: `You had him in trade talks and did not move him. He would rather be somewhere he was not being shopped.`,
    contract: `Talks on an extension have gone nowhere and he would rather be moved than play the year out.`,
  }[why] || `He would like a change.`
  return (
    <div className="fo-cast" role="dialog" aria-modal="true">
      <div className="fo-cast-in fo-askout">
        <div className="hd">
          <span className="ck">A phone call</span>
          <b>{player?.n || ask.sit.name} wants out</b>
        </div>
        <div className="bd">
          <p className="quote">
            &ldquo;{line} He has asked me to find him a new home. He would like you to hear that
            from me rather than read it somewhere.&rdquo;
          </p>
          <p className="attr">— his agent</p>
          <div className="opts">
            <button className="fo-btn" type="button" onClick={onTrade}>
              Move him
              <i>Opens the trade desk with him already on the block.</i>
            </button>
            <button className="fo-btn ghost" type="button" onClick={onTalk}>
              Sit down with him
              <i>About a {Math.round(talkOdds * 100)}% chance he stays and means it. If it fails he
                still wants out, and you have spent the conversation.</i>
            </button>
            <button className="fo-btn ghost danger" type="button" onClick={onRefuse}>
              Tell him no
              <i>He stays. Around {Math.round(REFUSAL_PENALTY * 100)}% off what he gives you for
                the rest of the season, and he asks again in the summer.</i>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ALL-STAR WEEKEND, as a place you go for five days in February.
function AllStarNight({ wk, game, mine, onEvent, onClose, event, onEventDone }) {
  const yours = wk.yoursIn
  const has = (k) => yours[k].length > 0
  return (
    <div className="fo-cast fo-awards" role="dialog" aria-modal="true">
      <div className={`aw as${has('game') || has('three') || has('dunk') ? ' yours' : ''}`}>
        <div className="aw-top">
          <span className="ck">All-Star weekend</span>
          <span className="aw-rank">{game ? `${game.winner} win it` : 'Saturday and Sunday'}
            <b>{(yours.game.length + yours.three.length + yours.dunk.length) || 'None'} of yours</b></span>
        </div>

        {event ? (
          <div className="as-play">
            {event === 'three'
              ? <ThreeContest me={yours.three[0]} cpu={wk.threeScores} onDone={onEventDone} />
              : <DunkContest me={yours.dunk[0]} cpu={wk.dunkScores} onDone={onEventDone} />}
          </div>
        ) : (
          <div className="aw-stage">
            <div className="aw-show" style={{ '--club': (CLUB[mine] || [])[0] || 'var(--acc)' }}>
              <CourtPlate />
              <Trophy tone={has('game') ? 'gold' : 'silver'} />
              <div className="aw-name">
                <span className="fn">All-Star weekend</span>
                <span className="ln">{game ? `${game.east}–${game.west}` : 'February'}</span>
                {game?.mvp && <span className="mine">{game.mvp.n} takes the MVP</span>}
              </div>
            </div>
            <div className="aw-side">
              <div className="aw-mark">Front Office<i>All-Star weekend</i></div>
              <h3>{game ? `${game.winner} win it` : 'Your men'}</h3>
              {['game', 'three', 'dunk'].map((k) => (
                <div key={k} className="as-slot">
                  <span className="fo-k">
                    {k === 'game' ? 'All-Star Game' : k === 'three' ? 'Three-point shootout' : 'Dunk contest'}
                  </span>
                  {yours[k].length ? (
                    <div className="who">
                      {yours[k].map((x) => <b key={x.id}><PName name={x.n} /></b>)}
                      {k !== 'game' && !game && (
                        <button className="fo-btn sm" type="button" onClick={() => onEvent(k)}>Shoot it yourself</button>
                      )}
                    </div>
                  ) : <span className="none">Nobody</span>}
                </div>
              ))}
              <div className="as-squads">
                {['East', 'West'].map((c) => (
                  <div key={c} className={`sq${game && game.winner === c ? ' won' : ''}`}>
                    <span className="fo-k">{c}{game ? ` · ${c === 'East' ? game.east : game.west}` : ''}</span>
                    <ol>
                      {wk.squads[c].squad.map((x, i) => (
                        <li key={x.id} className={`${i < 5 ? 'st' : ''}${x.team === mine ? ' own' : ''}`}>
                          <em>{x.team}</em>{x.n}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <p className="fo-muted as-note">
                Chosen off the first half you actually played — points, rebounds and assists,
                weighted by where the club sits, the same way a coach fills a ballot. The first
                five each side are the starters.
              </p>
            </div>
          </div>
        )}

        {!event && (
          <div className="aw-foot">
            <button className="fo-btn" type="button" onClick={onClose}>
              {game ? 'Back to the season' : 'Play the game'}
            </button>
            <span className="hint">
              {wk.squads.East.squad.length + wk.squads.West.squad.length} All-Stars named
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function ChapterCard({ ch, dev, onGo }) {
  return (
    <div className="fo-cast fo-chapter" role="dialog" aria-modal="true">
      <div className="fo-chapter-in">
        <div className="ck">Chapter {String(ch.n).padStart(2, '0')} · {ch.closingDate}</div>
        <div className="ends">
          <span className="lab">Closing</span>
          <h3>{ch.closing}</h3>
        </div>
        <ul className="facts">
          {ch.closed.map((f, i) => <li key={i}>{f}</li>)}
        </ul>

        {dev && dev.rows && dev.rows.length > 0 && (
          <div className="devwrap">
            <div className="lab">How the year changed them</div>
            <div className="devrows">
              {dev.rows.filter((r) => !r.gone).slice(0, 3).map((r) => (
                <span key={r.n} className={`dv ${r.tone}`}>{r.mark} <PName name={r.n} /></span>
              ))}
              {dev.rows.filter((r) => !r.gone).slice(-2).reverse().map((r) => (
                <span key={`b${r.n}`} className={`dv ${r.tone}`}>{r.mark} <PName name={r.n} /></span>
              ))}
            </div>
          </div>
        )}

        <div className="rule" />

        <div className="ends">
          <span className="lab">Opening · {ch.openingDate}</span>
          <h3 className="next">{ch.opening}</h3>
        </div>
        <p className="bl">{ch.blurb}</p>
        {ch.asks.length > 0 && (
          <ul className="asks">
            {ch.asks.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        )}
        <button className="fo-btn" type="button" style={{ marginTop: 16 }} onClick={onGo}>
          Begin {ch.opening.toLowerCase()}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ postseason */

// April to June is the part of the year everyone remembers, and it used to go past in one
// click. The bracket is held open instead: the round is named, East and West stay apart
// until the Finals, and you step it a game, a series or a round at a time.
function SeriesCard({ s, mine, seedOf, rec, onPlay, big }) {
  const [c1] = CLUB[s.hi] || ['#00A2E8']
  const [c2] = CLUB[s.lo] || ['#888']
  const involved = s.hi === mine || s.lo === mine
  const need = Math.floor(s.bestOf / 2) + 1
  const row = (t, other, colour) => {
    const out = s.winner && s.winner !== t
    return (
      <div className="tm" style={{ opacity: out ? 0.5 : 1 }}>
        <span className="sd">{seedOf[t] || '—'}</span>
        <span className="cr" style={{ background: colour, color: clubInk(t) }}>{t}</span>
        <span className="nm">{(CITY[t] || [])[1] || t}</span>
        {rec[t] && <span className="rc">{rec[t].w}–{rec[t].l}</span>}
        <span className={`wn${s.w[t] === need ? ' on' : ''}`}>{s.w[t]}</span>
      </div>
    )
  }
  return (
    <div className={`fo-series${involved ? ' mine' : ''}${big ? ' big' : ''}${s.winner ? ' done' : ''}`}>
      {s.stake && !s.winner && <div className="stake">{s.stake}</div>}
      {row(s.hi, s.lo, c1)}
      {row(s.lo, s.hi, c2)}
      {s.games.length > 0 && (
        <div className="gms">
          {s.games.map((g, i) => (
            <Tip key={i} as="span" tip={`Game ${i + 1} at ${(CITY[g.home] || [])[1] || g.home}: `
              + `${g.home} ${g.hs}, ${g.away} ${g.as}`}>
              <span className={`g${g.winner === mine ? ' me' : ''}`}>
                {Math.max(g.hs, g.as)}–{Math.min(g.hs, g.as)}
              </span>
            </Tip>
          ))}
        </div>
      )}
      {!s.winner && onPlay && (
        <button className="fo-btn ghost sm" type="button" style={{ marginTop: 9 }}
          onClick={() => onPlay(s)}>
          {s.bestOf === 1 ? 'Play it' : s.games.length ? 'Finish the series' : 'Play the series'}
        </button>
      )}
      {s.winner && (
        <div className="won">
          {(CITY[s.winner] || [])[1] || s.winner} win{s.bestOf === 1 ? '' : ` ${s.w[s.winner]}–${s.w[s.loser]}`}
        </div>
      )}
    </div>
  )
}

function PostseasonScreen({ save, po, run, report, onStep, onRound, onSeries, onFinish }) {
  const mine = save.franchise.team
  const stage = po.stage
  const idx = ROUNDS.findIndex((r) => r.key === stage)
  const meta = ROUNDS[idx] || ROUNDS[ROUNDS.length - 1]
  const here = roundSeries(po, stage)
  const open = here.filter((s) => !s.winner)
  const myLive = open.find((s) => s.hi === mine || s.lo === mine)
  const done = stage === 'done'
  const myRun = po.series.filter((s) => s.round !== 'playin' && (s.hi === mine || s.lo === mine))
  const out = myRun.some((s) => s.winner && s.winner !== mine)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>{done ? 'The postseason' : meta.name}</h2>
        <p>{done
          ? `${(CITY[po.champion] || [])[1] || po.champion} are champions.`
          : meta.blurb}</p>
      </div>

      <ol className="fo-rounds">
        {ROUNDS.map((r, i) => (
          <li key={r.key} className={done || i < idx ? 'past' : i === idx ? 'on' : ''}>
            <i>{String(i + 1).padStart(2, '0')}</i>{r.short}
          </li>
        ))}
      </ol>

      {!done && (
        <div className="fo-verdict" style={{ marginTop: 14 }}>
          <div className="h fo-faint">
            {myLive ? `You are in it — ${(CITY[myLive.hi === mine ? myLive.lo : myLive.hi] || [])[1]}`
              : out ? 'Your season is over' : 'Watching from the office'}
          </div>
          <div className="d">
            {open.length} series still live · {here.length - open.length} decided
            {myLive ? `. You lead ${myLive.w[mine]}–${myLive.w[myLive.hi === mine ? myLive.lo : myLive.hi]}.` : '.'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
            <button className="fo-btn" type="button" onClick={onStep}>Play the next game</button>
            <button className="fo-btn ghost" type="button" onClick={onRound}>
              Play the whole {meta.short.toLowerCase()}
            </button>
          </div>
        </div>
      )}

      {done ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Champions" note={save.franchise.currentSeason}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="fo-crest lg" style={{ background: (CLUB[po.champion] || [])[0],
                color: clubInk(po.champion) }}>{po.champion}</span>
              <div>
                <div style={{ font: '700 26px/1 "Barlow Semi Condensed",sans-serif',
                  letterSpacing: '.05em', textTransform: 'uppercase' }}>
                  {(CITY[po.champion] || []).join(' ')}
                </div>
                <div className="fo-muted" style={{ fontSize: 13, marginTop: 6 }}>
                  {po.champion === mine ? 'You won it all. The banner goes up.'
                    : `${(CITY[po.champion] || [])[1]} take the title.`}
                </div>
              </div>
            </div>
          </Card>
          <button className="fo-btn" type="button" style={{ marginTop: 14 }} onClick={onFinish}>
            Close the season out
          </button>
        </div>
      ) : (
        <div className="fo-grid" style={{ marginTop: 14,
          gridTemplateColumns: stage === 'finals' ? '1fr' : 'repeat(auto-fit,minmax(300px,1fr))' }}>
          {stage === 'finals' ? (
            <Card title="The Finals" note="East against West">
              {here.map((s, i) => (
                <SeriesCard key={i} s={s} mine={mine} seedOf={po.seedOf} rec={po.rec}
                  onPlay={onSeries} big />
              ))}
            </Card>
          ) : ['East', 'West'].map((c) => (
            <Card key={c} title={`${c}ern Conference`} note={meta.short}>
              {here.filter((s) => s.conf === c).map((s, i) => (
                <SeriesCard key={i} s={s} mine={mine} seedOf={po.seedOf} rec={po.rec} onPlay={onSeries} />
              ))}
            </Card>
          ))}
        </div>
      )}

      {po.series.some((s) => s.winner && s.round !== stage) && (
        <div style={{ marginTop: 16 }}>
          <Card title="Decided" note="everything already settled">
            <div className="fo-scrollbox" style={{ maxHeight: 260 }}>
              {po.series.filter((s) => s.winner && s.round !== stage).reverse().map((s, i) => (
                <div key={i} className="fo-row">
                  <span style={{ fontSize: 12.5 }}>
                    <b>{s.winner}</b> {s.bestOf === 1 ? 'beat' : `${s.w[s.winner]}–${s.w[s.loser]} over`} {s.loser}
                  </span>
                  <span className="r fo-faint" style={{ fontSize: 11 }}>
                    {s.round === 'playin' ? `Play-in · ${s.conf}` : `${roundName(s.round)} · ${s.conf}`}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// WHAT IS ON THE WALL.
//
// The schedule has always carried a date for every game — that is how the Cup group stage
// lands in November and the All-Star break in February. Nothing ever displayed one. This is
// the front office's wall calendar: what tonight is, who is next, and the dated marks
// between here and April.
function UpNext({ season, mine }) {
  const rows = useMemo(() => {
    if (!season?.schedule) return []
    try {
      return calAhead(season, mine, [
        { kind: 'deadline', game: DEADLINE_GAME, label: 'Trade deadline',
          note: 'the last day to change this team' },
        { kind: 'allstar', game: ALLSTAR_GAME, label: 'All-Star weekend',
          note: 'five days off' },
        { kind: 'end', game: 82, label: 'Last game of the regular season' },
      ], 5)
    } catch { return [] }
  }, [season, season?.played, mine])
  if (!rows.length) return null
  const now = calToday(season)
  return (
    <div className="fo-card fo-upnext" style={{ marginBottom: 14 }}>
      <h3><span className="tick" />Up next
        <span className="note">
          {DAY_NAME[weekday(now.date)]} {dateLabel(now.date)}
        </span>
      </h3>
      <div className="fo-body flush">
        <ul>
          {rows.map((r) => (
            <li key={`${r.kind}-${r.day}`} className={r.kind}>
              <span className="dt">
                <b>{dateLabel(r.date)}</b>
                <i>{DAY_NAME[weekday(r.date)]}</i>
              </span>
              <span className="tx">
                {r.label}
                {r.note && <i>{r.note}</i>}
              </span>
              <span className="in">{whenText(r.inDays)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SeasonScreen({ save, season, po, run, report, inbox, auto, phase, phaseCtx, onAdvance,
  onPlay, onWatch, onStop, onRun, onPlayoffs, onAccept, onPass, onRoll, onCup }) {
  const mine = save.franchise.team
  const tab = useMemo(() => standings(season), [season.played, season])
  const rec = season.rec[mine]
  const games = teamGames(season, mine)
  const recent = games.slice(-6).reverse()
  const seed = tab.East.concat(tab.West).length
    && (tab.East.findIndex((r) => r.team === mine) + 1 || tab.West.findIndex((r) => r.team === mine) + 1)
  const wCount = useCountUp(rec.w, 420)
  const lCount = useCountUp(rec.l, 420)
  const won = (g) => (g.home === mine ? g.hs > g.as : g.as > g.hs)
  const split = (gs) => (gs.length ? `${gs.filter(won).length}–${gs.filter((g) => !won(g)).length}` : '—')
  const streak = (() => {
    let n = 0, w = false
    for (let i = games.length - 1; i >= 0; i--) {
      const r = won(games[i])
      if (n === 0) { w = r; n = 1; continue }
      if (r !== w) break
      n++
    }
    return { n: games.length ? n : 0, w }
  })()
  const done = season.played >= season.schedule.length
  const next = !done && season.schedule[season.played]
  const myNext = season.schedule.slice(season.played).find(([h, a]) => h === mine || a === mine)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>The season</h2>
        <p>Every game is simulated possession by possession from the same Savant profiles the
          analytics screen shows. Nothing here is scripted.</p>
      </div>

      {phase && (
        <div style={{ marginBottom: 14 }}>
          <PhaseCard save={save} ctx={phaseCtx || {}} onGo={() => {}} onAdvance={onAdvance} />
        </div>
      )}

      <UpNext season={season} mine={mine} />

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', marginBottom: 14 }}>
        <Card title={`${CITY[mine][1]} · ${SEED.season}`} note={`Game ${Math.min(season.played + 1, 1230)} of 1230`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div>
              <div className="fo-big">{Math.round(wCount)}<span className="fo-faint">–{Math.round(lCount)}</span></div>
              <div className="fo-k" style={{ marginTop: 6 }}>
                {games.length} played · {82 - games.length} left</div>
            </div>
            <Ring value={Math.round((rec.w / Math.max(1, games.length)) * 100)} label="WIN%" floor={0} />
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <Tip right tip="Points scored and allowed per game so far. The engine plays ~98.5 possessions a night, so these move like real NBA numbers.">
                <div className="fo-k">Scoring</div>
              </Tip>
              <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>
                {games.length ? (rec.pf / games.length).toFixed(1) : '—'} <span className="fo-faint">for</span></div>
              <div className="mono" style={{ fontSize: 13, marginTop: 3 }}>
                {games.length ? (rec.pa / games.length).toFixed(1) : '—'} <span className="fo-faint">against</span></div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px' }}>
            <Bar pct={(games.length / 82) * 100} />
            <span className="fo-k">{Math.round((games.length / 82) * 100)}% of your season</span>
          </div>
          {!done ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {auto > 0 ? (
                <button className="fo-btn" type="button" onClick={onStop}>Stop · {auto} games left to play</button>
              ) : (
                <>
                  <button className="fo-btn sm" type="button" onClick={() => onWatch()}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
                    Watch next game
                  </button>
                  <button className="fo-btn ghost sm" type="button" onClick={() => onPlay(1)}>Sim next</button>
                  <button className="fo-btn ghost sm" type="button" onClick={() => onPlay(5)}>Sim 5</button>
                  <button className="fo-btn ghost sm" type="button" onClick={() => onPlay(10)}>Sim 10</button>
                  {phase?.games && games.length < phase.games && (
                    <button className="fo-btn ghost sm" type="button"
                      onClick={() => onPlay(phase.games - games.length)}>
                      Play to game {phase.games}
                    </button>
                  )}
                  {/* The long runs. These cross stages on their own and stop where there is
                      something to decide. */}
                  {onRun && games.length < DEADLINE_GAME && (
                    <button className="fo-btn sm" type="button" onClick={() => onRun(DEADLINE_GAME)}>
                      Play to the deadline
                    </button>
                  )}
                  {onRun && games.length >= DEADLINE_GAME && games.length < 82 && (
                    <button className="fo-btn sm" type="button" onClick={() => onRun(82)}>
                      Play to the end of the season
                    </button>
                  )}
                </>
              )}
            </div>
          ) : !po ? (
            <button className="fo-btn" type="button" onClick={onPlayoffs}>Start the postseason</button>
          ) : (
            <button className="fo-btn" type="button" onClick={onRoll}>Take the offseason</button>
          )}
          <div className="fo-cells" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 16 }}>
            <div><span className="fo-k">Last 10</span><div className="v">{split(games.slice(-10))}</div></div>
            <div><span className="fo-k">Home</span><div className="v">{split(games.filter((g) => g.home === mine))}</div></div>
            <div><span className="fo-k">Road</span><div className="v">{split(games.filter((g) => g.away === mine))}</div></div>
            <div>
              <Tip tip="Consecutive wins or losses. Streaks come out of the possession model, not a momentum dial — there is no such thing in here.">
                <span className="fo-k">Streak</span>
              </Tip>
              <div className="v" style={{ color: streak.n === 0 ? 'var(--faint)'
                : streak.w ? 'var(--good)' : 'var(--bad)' }}>
                {streak.n ? `${streak.w ? 'W' : 'L'}${streak.n}` : '—'}
              </div>
            </div>
          </div>
          {myNext && !done && (
            <div className="fo-k" style={{ marginTop: 12 }}>
              Next for you: {myNext[0] === mine ? 'vs' : 'at'} {myNext[0] === mine ? myNext[1] : myNext[0]}
              {next && next[0] !== mine && next[1] !== mine
                ? ` · league is on ${next[1]} at ${next[0]}` : ''}
            </div>
          )}
        </Card>

        {season.cupGroups && !season.knockout?.champion && (
          <div style={{ gridColumn: '1/-1' }}>
            <CupGroups season={season} mine={mine} />
            {cupGroupDone(season) && (
              <button className="fo-btn" type="button" style={{ marginTop: 10 }} onClick={onCup}>
                {season.knockout ? 'Back to the Cup bracket' : 'Draw the Cup bracket'}
              </button>
            )}
          </div>
        )}
        <Card title="Latest results" note={`${CITY[mine][0]}`} flush>
          {!recent.length && <div className="fo-empty">The season has not started.</div>}
          {recent.map((g) => {
            const home = g.home === mine
            const my = home ? g.hs : g.as
            const th = home ? g.as : g.hs
            return (
              <div key={g.i} className="fo-row" style={{ padding: '9px 15px' }}>
                <span className="fo-av sm" style={{ background: CLUB[home ? g.away : g.home]?.[0],
                  color: clubInk(home ? g.away : g.home) }}>
                  {home ? g.away : g.home}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="nm">{home ? 'vs' : 'at'} {CITY[home ? g.away : g.home][1]}</span>
                  <span className="sub">{g.nPoss} possessions</span>
                </span>
                <span className="r">
                  <b style={{ color: my > th ? 'var(--good)' : 'var(--bad)' }}>{my > th ? 'W' : 'L'}</b>
                  <span>{my}–{th}</span>
                </span>
              </div>
            )
          })}
        </Card>
      </div>

      {inbox && (
        <div style={{ marginBottom: 14 }}>
          <DeadlineInbox offers={inbox} mine={mine} onAccept={onAccept} onPass={onPass} />
        </div>
      )}

      {po && (
        <div style={{ marginBottom: 14 }}>
          <PlayoffBracket po={po} mine={mine} />
        </div>
      )}

      {report && (
        <Card title="Season report" note={report.record} style={{ marginBottom: 14 }}>
          <div className="fo-cells" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 14 }}>
            <div><span className="fo-k">Offense</span><div className="v">{report.ortg} <small className="fo-faint">#{report.ortgRank}</small></div></div>
            <div><span className="fo-k">Defense</span><div className="v">{report.drtg} <small className="fo-faint">#{report.drtgRank}</small></div></div>
            <div><span className="fo-k">Net</span><div className="v" style={{ color: report.net > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {report.net > 0 ? '+' : ''}{report.net} <small className="fo-faint">#{report.netRank}</small></div></div>
          </div>
          {report.verdict.map((v, i) => (
            <p key={i} style={{ margin: '0 0 7px', fontSize: 13.5, color: i === 0 ? 'var(--ink)' : 'var(--muted)' }}>{v}</p>
          ))}
          {run?.path?.length > 0 && (
            <div className="mono fo-faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.7 }}>
              {run.path.map((s, i) => (
                <div key={i}>{s.name} {s.won ? 'beat' : 'lost to'} {s.opp} {s.w}–{s.l}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        <StandingsTable tab={tab} mine={mine} conf="East" />
        <StandingsTable tab={tab} mine={mine} conf="West" />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- offseason */

// A prospect on your board. The confidence pip is the honest part: it says how much of
// this ranking is scouting and how much is a coin flip.
function ProspectRow({ p, view, selected, onSelect, onPick }) {
  const q = view?.q ?? p.q ?? 0.3
  const conf = q >= 0.5 ? 'high' : q >= 0.4 ? 'fair' : q >= 0.3 ? 'thin' : 'guess'
  return (
    <div className={`fo-prow${selected ? ' on' : ''}`} role="button" tabIndex={0}
      onClick={() => onSelect(p)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(p) }}>
      <span className="rk">{p.board}</span>
      <span className="tx">
        <span className="nm">{p.name}</span>
        <span className="sub">{p.pos} · {p.height} · {p.school} · {p.arch}</span>
      </span>
      <Tip tip={`Scouting confidence: ${conf}. ${p.covered ? 'Your staff covers ' + p.regionLabel + '.'
        : 'Nobody on staff covers ' + p.regionLabel + '.'}`}>
        <span className={`conf ${conf}`} />
      </Tip>
      {onPick && (
        <button className="fo-btn sm" type="button"
          onClick={(e) => { e.stopPropagation(); onPick(p) }}>Draft</button>
      )}
    </div>
  )
}

// The Savant profile, as far as your scouts can see it.
function SkillBars({ view }) {
  const order = ['sh', 'gr', 'sc', 'pm', 'rpr', 'bs', 'pd', 'rp', 'sz']
  return (
    <div className="fo-skills">
      {order.map((k) => {
        const v = view.seen[k]
        const sharp = view.sharp.includes(k)
        return (
          <div key={k} className="row">
            <span className="k">{SKILL_LABEL[k]}</span>
            <span className="bar"><i style={{ width: `${Math.max(2, v)}%` }} /></span>
            <span className={`v${sharp ? ' sharp' : ''}`}>{v}{sharp ? '*' : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function ProspectProfile({ p, view, rep, onPick, onWorkout, workoutsLeft }) {
  if (!p) return <div className="fo-empty">Pick a name off the board.</div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 26, color: 'var(--acc)' }}>
          {String(p.board).padStart(2, '0')}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</div>
          <div className="fo-k" style={{ marginTop: 4 }}>
            {p.school} · {p.regionLabel} · {p.pos} · {p.classYear} · age {p.age}
          </div>
        </div>
        <Tip right tip="A grade is an opinion off your own board, not a fact. It moves when your scouting does.">
          <span className="fo-grade" style={{ marginLeft: 'auto' }}>{gradeOf(p.board)}</span>
        </Tip>
      </div>

      <div className="fo-measure">
        {[['HT', p.height], ['WS', p.wingspan], ['WT', p.weight], ['TYPE', p.type === 'project' ? 'Project' : 'Ready']]
          .map(([k, v]) => (
            <div key={k}><b>{v}</b><i>{k}</i></div>
          ))}
      </div>

      <div className="fo-k" style={{ margin: '15px 0 8px' }}>
        {p.arch} · scouting confidence {rep.confidence}
        {rep.workouts ? ` · ${rep.workouts} workout${rep.workouts === 1 ? '' : 's'}` : ''}
      </div>
      <SkillBars view={view} />

      <div className="fo-report">
        <div className="hd">{rep.head}</div>
        {rep.strengths.map((x, i) => <div key={`s${i}`} className="pt good">+ {x}</div>)}
        {rep.concerns.map((x, i) => <div key={`c${i}`} className="pt bad">− {x}</div>)}
        {rep.projection && <div className="pj">{rep.projection}</div>}
        {rep.sharpNote && <div className="pj faint">{rep.sharpNote}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
        {onWorkout && (
          <button className="fo-btn ghost sm" type="button" disabled={workoutsLeft <= 0}
            onClick={() => onWorkout(p)}>
            {workoutsLeft > 0 ? `Bring him in for a workout (${workoutsLeft} left)` : 'No workouts left'}
          </button>
        )}
        {onPick && <button className="fo-btn" type="button" onClick={() => onPick(p)}>Draft {p.name}</button>}
      </div>
    </div>
  )
}

// Who you employ, and what the department can actually see.
function ScoutingDept({ save, onHire, onFire, open }) {
  const staff = save.scouts || []
  const spend = payroll(staff)
  const cov = coverage(staff)
  const market = (save.scoutMarket || []).filter((m) => !staff.some((s) => s.id === m.id))
  return (
    <Card title="Scouting department" note={`${short(spend)} of ${short(SCOUT_BUDGET)}`}>
      <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        A board is an opinion assembled by people you hired. A scout inside his own region is
        about as reliable as the model itself; outside it he is guessing with everyone else.
      </p>

      <div className="fo-cov">
        {REGIONS.map((reg) => {
          const c = cov[reg.key]
          return (
            <Tip key={reg.key} tip={c.scouts.length
              ? `${c.scouts.map((s) => s.name).join(', ')} — ${c.level === 'deep' ? 'deep coverage' : 'covered'}`
              : `No eyes on ${reg.label}. Prospects from here are close to a coin flip.`}>
              <span className={`cell ${c.level}`}>{reg.label}</span>
            </Tip>
          )
        })}
      </div>

      <div style={{ marginTop: 13 }}>
        {staff.map((sc) => (
          <div key={sc.id} className="fo-row">
            <span className="fo-av sm">{initials(sc.name)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="nm">{sc.name}</span>
              <span className="sub">{describeScout(sc)}</span>
            </span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>
              {short(sc.salary)}
            </span>
            {open && (
              <button className="fo-btn ghost sm" type="button" onClick={() => onFire(sc)}>Let go</button>
            )}
          </div>
        ))}
        {!staff.length && <div className="fo-empty">No scouts. Your board is guesswork.</div>}
      </div>

      {open && (
        <>
          <div className="fo-k" style={{ margin: '15px 0 8px' }}>Available</div>
          <div className="fo-scrollbox" style={{ maxHeight: 240 }}>
            {market.map((sc) => {
              const afford = spend + sc.salary <= SCOUT_BUDGET
              return (
                <div key={sc.id} className="fo-row">
                  <span className="fo-av sm">{initials(sc.name)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{sc.name} <i className="fo-k">· {sc.reputation}</i></span>
                    <span className="sub">{describeScout(sc)}</span>
                  </span>
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5,
                    color: afford ? 'var(--faint)' : 'var(--bad)' }}>{short(sc.salary)}</span>
                  <button className="fo-btn sm" type="button" disabled={!afford}
                    onClick={() => onHire(sc)}>Hire</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

function OffseasonScreen({ save, offs, onDraft, onNegotiate, onLetGo, onFinish,
  onHire, onFire, onWorkout, onOffer, onWithdraw, onMarket }) {
  const mine = save.franchise.team
  const [sel, setSel] = useState(null)
  const [faView, setFaView] = useState('afford')
  if (!offs) {
    return (
      <div className="fo-page">
        <div className="fo-h">
          <h2>Offseason</h2>
          <p>The lottery, the draft and your own expiring contracts. It opens once the postseason
            is finished.</p>
        </div>
        <div className="fo-empty">Play the season first — the draft order comes from the standings.</div>
      </div>
    )
  }

  const myPickNos = offs.draftRes.picks.filter((p) => p.userPick).map((p) => p.overall)
  const onClock = offs.draftRes.picks.find((p) => p.userPick && !offs.made[p.overall])
  // Only the picks made BEFORE yours are off the board. Excluding everyone the AI takes
  // across both rounds left a late first-rounder choosing between two leftovers.
  const gone = new Set(Object.values(offs.made).map((p) => p.id))
  if (onClock) {
    for (const p of offs.draftRes.picks)
      if (p.prospect && p.overall < onClock.overall) gone.add(p.prospect.id)
  }
  const board = offs.board.filter((p) => !gone.has(p.id))
    .sort((a, b) => a.board - b.board).slice(0, 30)

  // The profile is regenerated from the same seed every render, so a prospect's report does
  // not reshuffle itself every time you click him. What DOES move it is scouting.
  const shown = sel && board.some((p) => p.id === sel.id) ? sel : board[0]
  const seedFor = (p) => rng((parseInt(String(p.id).replace(/\D/g, ''), 10) || 1)
    * 7919 + Object.keys(save.workouts || {}).length * 13 + (save.scouts || []).length)
  const selView = shown ? scoutedProfile(shown, save.scouts || [], seedFor(shown),
    { workouts: save.workouts || {} }) : null
  const selRep = shown && selView ? scoutReport(shown, selView) : null
  const WORKOUT_BUDGET = 6
  const workoutsLeft = WORKOUT_BUDGET
    - Object.values(save.workouts || {}).reduce((a, b) => a + b, 0)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Offseason · {offs.year}</h2>
        {/* The page used to open on a methodology note about scouting accuracy. It is a true
            and useful note, but it is not what somebody standing here needs first: three
            things have to happen before next season starts, and one of them is already
            waiting on them. Say the job, then the caveat. */}
        <p>{onClock
          ? <>You are on the clock at <b>#{onClock.overall}</b>. Draft, then settle your own
            expiring contracts and work the open market — next season cannot start until
            your picks are made.</>
          : <>Draft, settle your own expiring contracts, work the open market. Next season
            starts when all three are done.</>}
        </p>
        <p className="fo-muted" style={{ fontSize: 13, marginTop: 6 }}>
          Scouting is fogged on purpose. The model correlates +0.54 with what prospects
          actually become — better than the real draft order, and nowhere near certain.
        </p>
      </div>

      {/* ORDER OF BUSINESS.
          Not on the clock, the year's development report is the right thing to read first.
          On the clock it is an epilogue sitting on top of the only control that matters,
          and the board — the card actually saying "On the clock · pick #29" — was the
          third thing down the page, below the fold. Same markup, reordered by the same
          flag that already collapses the scouting department when a pick is live. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>

      {offs.development && (
        <div style={{ marginBottom: 14, order: onClock ? 2 : 1 }}>
          <Card title="How the year changed them"
            note={`${offs.development.risers} improved · ${offs.development.fallers} slipped`}>
            <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 11px' }}>
              Measured against what the age says should have happened, not against last year. A
              34-year-old losing half a point is normal; a 21-year-old gaining half a point is
              normal too. What is shown is the difference between the two.
            </p>
            <div className="fo-dev">
              {offs.development.rows.filter((r) => !r.gone).map((r, i) => {
                const span = Math.max(0.01, Math.abs(r.rel))
                const w = Math.min(100, (span / 1.4) * 100)
                return (
                  <Tip key={`${r.uid || r.n}-${i}`} as="div" tip={`${r.n} went from ${r.from.toFixed(2)} to `
                    + `${r.to.toFixed(2)} VORP at ${Math.round(r.age)}. A typical player that age `
                    + `${r.exp >= 0 ? 'gains' : 'loses'} ${Math.abs(r.exp).toFixed(2)}, so this is `
                    + `${r.rel >= 0 ? '+' : ''}${r.rel.toFixed(2)} against the curve.`}>
                    <div className={`row ${r.tone}`}>
                      <span className="mk">{r.mark}</span>
                      <span className="nm"><PName name={r.n} /></span>
                      <span className="ag">{Math.round(r.age)}</span>
                      <span className="bar">
                        <i style={{ width: `${w}%`, marginLeft: r.rel >= 0 ? '50%' : `${50 - w}%` }} />
                      </span>
                      <span className="dl">{r.rel >= 0 ? '+' : ''}{r.rel.toFixed(2)}</span>
                      <span className="lb">{r.label}</span>
                    </div>
                  </Tip>
                )
              })}
            </div>
            {offs.development.departed.length > 0 && (
              <div className="fo-faint" style={{ fontSize: 12, marginTop: 10 }}>
                Gone: {offs.development.departed.join(', ')}
              </div>
            )}
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 14, order: onClock ? 3 : 2 }}>
        <ScoutingDept save={save} onHire={onHire} onFire={onFire} open={!onClock} />
      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.05fr)', marginBottom: 14, order: onClock ? 1 : 3 }}>
        <Card title="Your board"
          note={myPickNos.length ? `You pick ${myPickNos.map((n) => `#${n}`).join(', ')}` : 'No picks'}>
          {onClock && (
            <div className="fo-k" style={{ marginBottom: 9, color: 'var(--acc)' }}>
              On the clock · pick #{onClock.overall}
            </div>
          )}
          <div className="fo-scrollbox" style={{ maxHeight: 430 }}>
            {board.map((p) => (
              <ProspectRow key={p.id} p={p} selected={shown?.id === p.id} onSelect={setSel}
                onPick={onClock ? (x) => onDraft(onClock, x) : null} />
            ))}
            {!board.length && <div className="fo-empty">The board is empty.</div>}
          </div>
        </Card>

        <Card title="Scouting report" note={selView ? `${selView.confidence} confidence` : ''}>
          <ProspectProfile p={shown} view={selView} rep={selRep}
            onPick={onClock ? (x) => onDraft(onClock, x) : null}
            onWorkout={!onClock ? onWorkout : null}
            workoutsLeft={workoutsLeft} />
        </Card>
      </div>

      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(310px,1fr))' }}>
        <Card title="Around the first round" note={`${offs.year} draft`}>
          <div className="fo-scrollbox" style={{ maxHeight: 300 }}>
            {offs.draftRes.picks.filter((p) => p.overall <= 14).map((p) => (
              <div key={p.overall} className="fo-row">
                <span className="fo-av sm" style={{ background: CLUB[p.team]?.[0], color: clubInk(p.team) }}>{p.overall}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="nm">{offs.made[p.overall]?.name || p.prospect?.name || '—'}</span>
                  <span className="sub">{CITY[p.team][1]}
                    {p.prospect ? ` · ${p.prospect.pos} · ${p.prospect.school}` : ''}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="The open market"
          note={offs.faDone ? 'signed' : `${(offs.pool || []).length} free agents`}>
          <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 11px' }}>
            Every expiring contract in the league, not just yours. What you may offer is decided
            by the cap: your own players you can go over it for — that is what Bird rights are —
            and everyone else costs room or an exception.
          </p>
          {!offs.faDone ? (
            <>
              {(() => {
                const budget = maxOffer(mine, { from: '—' }, save.league.rosters)
                const st2 = status(teamSalary(rosterOf(save) || []))
                return (
                  <div className="fo-budget">
                    <b>{short(budget)}</b>
                    <i>{st2.overApron2 ? 'above the second apron — minimum contracts only'
                      : st2.overApron1 || st2.overTax ? 'the taxpayer mid-level is all you have'
                        : budget > CBA.mle_nontax ? 'in cap room' : 'the full mid-level'}</i>
                  </div>
                )
              })()}
              <div style={{ display: 'flex', gap: 7, margin: '11px 0 9px', flexWrap: 'wrap' }}>
                {[['afford', 'Who you can sign'], ['all', 'Everyone']].map(([k, lab]) => (
                  <button key={k} type="button"
                    className={`fo-btn ghost sm${faView === k ? ' on' : ''}`}
                    onClick={() => setFaView(k)}>{lab}</button>
                ))}
              </div>
              <div className="fo-scrollbox" style={{ maxHeight: 340 }}>
                {(faView === 'all' ? (offs.pool || [])
                  : (offs.pool || []).filter((p) =>
                    maxOffer(mine, p, save.league.rosters) >= askingPrice(p) * 0.85)
                ).slice(0, 40).map((p) => {
                  const price = askingPrice(p)
                  const cap = maxOffer(mine, p, save.league.rosters)
                  const bid = offs.faOffers[p.uid]
                  const canBid = cap >= price * 0.75
                  return (
                    <div key={p.uid} className="fo-row">
                      <span className="fo-av sm" style={{ background: CLUB[p.from]?.[0], color: clubInk(p.from) }}>
                        {p.from}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="nm"><PName p={p} /></span>
                        <span className="sub">
                          {p.pos || '—'} · age {typeof p.a === 'number' ? p.a.toFixed(0) : '—'} ·
                          asks {short(price)}{cap < price ? ` · you can offer ${short(cap)}` : ''}
                        </span>
                      </span>
                      {bid ? (
                        <>
                          <span className="fo-tag" style={{ marginLeft: 'auto' }}>bid {short(bid.salary)}</span>
                          <button className="fo-btn ghost sm" type="button" onClick={() => onWithdraw(p)}>Pull</button>
                        </>
                      ) : (
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button className="fo-btn ghost sm" type="button" disabled={!canBid}
                            onClick={() => onOffer(p, Math.min(cap, price), (p.v ?? 0) > 2 ? 3 : 2)}>
                            {canBid ? `Offer ${short(Math.min(cap, price))}` : 'No room'}
                          </button>
                          {canBid && cap > price && (
                            <button className="fo-btn sm" type="button"
                              onClick={() => onOffer(p, Math.min(cap, Math.round(price * 1.2)), 4)}>
                              Overpay
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {faView === 'afford' && !(offs.pool || []).some((p) =>
                maxOffer(mine, p, save.league.rosters) >= askingPrice(p) * 0.85) && (
                <div className="fo-empty">
                  Nothing on this market you can pay for. That is what being a taxpayer costs you —
                  from here the only way to add salary is a trade.
                </div>
              )}
              <button className="fo-btn" type="button" style={{ marginTop: 12 }} onClick={onMarket}>
                {Object.keys(offs.faOffers).length
                  ? `Open the market with ${Object.keys(offs.faOffers).length} offer${Object.keys(offs.faOffers).length === 1 ? '' : 's'} out`
                  : 'Open the market without bidding'}
              </button>
            </>
          ) : (
            <>
              <div className="fo-k" style={{ marginBottom: 9 }}>
                {offs.faResult?.mine?.length ? 'You signed' : 'You signed nobody'}
              </div>
              {(offs.faResult?.mine || []).map((m, i) => (
                <div key={i} className="fo-row">
                  <span className="fo-av sm">{initials(m.player.n)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{m.player.n}</span>
                    <span className="sub">{short(m.salary)} × {m.years} · was {m.player.from}</span>
                  </span>
                </div>
              ))}
              <div className="fo-k" style={{ margin: '13px 0 8px' }}>Around the league</div>
              {(offs.faResult?.signings || []).filter((x) => !x.stayed && (x.player.v ?? 0) > 1)
                .slice(0, 8).map((x, i) => (
                  <div key={i} className="fo-row">
                    <span className="fo-av sm" style={{ background: CLUB[x.team]?.[0], color: clubInk(x.team) }}>
                      {x.team}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="nm">{x.player.n}</span>
                      <span className="sub">{short(x.salary)} × {x.years} · from {x.player.from}</span>
                    </span>
                  </div>
                ))}
            </>
          )}
        </Card>

        <Card title="Your free agents" note={`${offs.expiring.length} expiring`}>
          <p className="fo-muted" style={{ fontSize: 13, margin: '0 0 11px' }}>
            Every one of these has an agent, a price and other teams calling. Lowball him enough
            times and he stops taking your calls.
          </p>
          {!offs.expiring.length && <div className="fo-empty">Nobody is coming off the books.</div>}
          {offs.expiring.map((p) => {
            const st = offs.talks[p.uid]
            return (
              <div key={p.uid} style={{ border: '1px solid var(--line)', borderRadius: 6,
                padding: 11, marginBottom: 9, background: 'var(--panel-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="fo-av sm">{initials(p.n)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}><PName p={p} /></span>
                    <span className="fo-k" style={{ display: 'block', marginTop: 4 }}>
                      {p.pos || '—'} · age {p.a || '—'} · was {short(p.s)}</span>
                  </span>
                  <Tip right tip="The market price is measured, not invented: 251 veteran contracts fit against projected production, age and minutes. The residual spread is ±$10.4M, which is the room a negotiation lives in.">
                    <span className="fo-k" style={{ marginLeft: 'auto' }}>ask {short(st?.ask ?? 0)}</span>
                  </Tip>
                </div>
                <div className="mono" style={{ fontSize: 12, color: st?.tone === 'bad' ? 'var(--bad)'
                  : st?.tone === 'good' ? 'var(--good)' : 'var(--muted)', margin: '9px 0 0', lineHeight: 1.5 }}>
                  {st?.message || 'His agent is waiting on a number.'}
                </div>
                {st?.state === 'open' && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                    <button className="fo-btn sm" type="button"
                      onClick={() => onNegotiate(p, st.ask, 3)}>Meet {short(st.ask)}</button>
                    <button className="fo-btn ghost sm" type="button"
                      onClick={() => onNegotiate(p, Math.round(st.ask * 0.82), 3)}>Offer {short(st.ask * 0.82)}</button>
                    <button className="fo-btn ghost sm" type="button"
                      onClick={() => onNegotiate(p, Math.round(st.ask * 0.62), 2)}>Lowball {short(st.ask * 0.62)}</button>
                    <button className="fo-btn danger sm" type="button" onClick={() => onLetGo(p)}>Let him walk</button>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      </div>

      <div className="fo-verdict" style={{ marginTop: 14 }}>
        <div className="h fo-acc">Close the offseason</div>
        <div className="d">
          Draft picks join on rookie scale, everyone you kept is re-signed, the roster refills to
          fourteen with minimum contracts, and ownership files its review of your year.
        </div>
        <button className="fo-btn" type="button" style={{ marginTop: 12 }}
          disabled={!!onClock} onClick={onFinish}>
          {onClock ? 'You are on the clock' : `Start ${offs.nextLabel}`}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- finances / report */

function FinancesScreen({ save, roster }) {
  const tot = teamSalary(roster)
  const st = status(tot)
  const market = SEED.teams[save.franchise.team]?.market ?? 0
  const taxBill = (() => {
    let over = Math.max(0, tot - CBA.tax), bill = 0
    const rates = [1.5, 1.75, 2.5, 3.25]
    for (let i = 0; i < rates.length && over > 0; i++) {
      const band = Math.min(over, 5_000_000)
      bill += band * rates[i]; over -= band
    }
    return bill + over * 3.75
  })()
  const rows = [
    ['Salary cap', CBA.cap, 'The line under which a team can sign outside free agents with room.'],
    ['Luxury tax', CBA.tax, 'Payroll above this is taxed at a rising rate, paid by the owner.'],
    ['First apron', CBA.apron1, APRON_CONSEQUENCE.apron1],
    ['Second apron', CBA.apron2, APRON_CONSEQUENCE.apron2],
  ]
  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Finances</h2>
        <p>Real 2026-27 cap constants. Every line here is the number the league actually uses,
          not a scaled stand-in.</p>
      </div>
      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))' }}>
        <Card title="Where you sit" note={statusLabel(st)}>
          <div className="fo-big" style={{ color: st.overApron2 ? 'var(--bad)' : st.overTax ? 'var(--warn)' : 'var(--ink)' }}>
            {fmt(tot)}
          </div>
          <div className="fo-k" style={{ marginTop: 7 }}>Team salary · {roster.length} contracts</div>
          <div style={{ marginTop: 16 }}>
            {rows.map(([k, v, tip]) => (
              <div key={k} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Tip tip={tip}><span className="fo-k">{k}</span></Tip>
                  <span className="mono fo-faint" style={{ fontSize: 11.5 }}>{short(v)}</span>
                </div>
                <Bar pct={(tot / v) * 100} color={tot > v ? 'var(--bad)' : 'var(--acc)'} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="The owner's bill" note={taxBill > 0 ? 'In the tax' : 'Clean'}>
          <div className="fo-cells" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><span className="fo-k">Tax bill</span>
              <div className="v" style={{ color: taxBill > 0 ? 'var(--bad)' : 'var(--good)' }}>{short(taxBill)}</div></div>
            <div><span className="fo-k">Room</span>
              <div className="v">{st.underCap ? short(st.space) : '—'}</div></div>
            <div><span className="fo-k">Market size</span>
              <div className="v">{market > 0.5 ? 'Large' : market < -0.5 ? 'Small' : 'Mid'}</div></div>
            <div><span className="fo-k">To first apron</span>
              <div className="v">{short(CBA.apron1 - tot)}</div></div>
          </div>
          <p className="fo-muted" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.55 }}>
            The repeater rates are not in here yet. Everything else — the brackets, both aprons and
            what each one takes away from you — is.
          </p>
          <div style={{ marginTop: 12 }}>
            {['apron1', 'apron2'].map((k) => (
              <div key={k} style={{ padding: '9px 11px', borderRadius: 5, marginBottom: 7,
                border: '1px solid var(--line)',
                background: (k === 'apron1' ? st.overApron1 : st.overApron2)
                  ? 'color-mix(in srgb,var(--bad) 10%,transparent)' : 'var(--panel-2)' }}>
                <div className="fo-k" style={{ marginBottom: 5 }}>
                  {k === 'apron1' ? 'First apron' : 'Second apron'}
                  {(k === 'apron1' ? st.overApron1 : st.overApron2) && <span className="fo-bad"> · you are over</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{APRON_CONSEQUENCE[k]}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Payroll by contract" note="Largest first" flush>
          <div className="fo-scrollbox" style={{ maxHeight: 460 }}>
            {[...roster].sort((a, b) => b.s - a.s).map((p, i) => (
              <div key={`${p.uid || p.n}-${i}`} className="fo-row" style={{ padding: '8px 15px' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="nm"><PName p={p} /></span>
                  <span className="sub">{p.yr} yr{p.yr === 1 ? '' : 's'}{p.o ? ` · ${p.o}` : ''}</span>
                </span>
                <div style={{ width: 90 }}><Bar pct={(p.s / (CBA.max_35 || 60e6)) * 100} /></div>
                <span className="mono" style={{ width: 82, textAlign: 'right', fontSize: 12 }}>{fmt(p.s)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

const SKILL_KEYS = [
  ['sc', 'Shot creation', 'How much of his own offence a player generates rather than receives. Built from usage, unassisted shot rate and rim pressure.'],
  ['sh', 'Shooting', 'Three-point accuracy weighted by volume and stabilised toward a positional prior until the sample earns its own number.'],
  ['pm', 'Playmaking', 'Assist creation net of turnovers, adjusted for how much the ball is in his hands.'],
  ['gr', 'Gravity', 'What he does to a defence without the ball — the shooting the defence has to respect off the catch.'],
  ['rp', 'Rim protection', 'Shot deterrence and contest quality at the basket, not just blocks.'],
  ['pd', 'Perimeter defence', 'Matchup-adjusted defensive impact on the ball and in space.'],
]

function ReportScreen({ save, roster }) {
  const mine = save.franchise.team
  const rows = useMemo(() => SKILL_KEYS.map(([k, label, tip]) => {
    const w = (rs) => {
      let n = 0, d = 0
      for (const p of rs) { if (p[k] == null) continue; const m = Math.max(1, p.mpg || 12); n += m * p[k]; d += m }
      return d ? n / d : null
    }
    const me = w(roster)
    const others = TEAMS.filter((t) => t !== mine).map((t) => w(rostersOf(t))).filter((v) => v != null)
    const sorted = [...others].sort((a, b) => a - b)
    let below = 0
    for (const v of sorted) if (v < me) below++
    return { k, label, tip, value: Math.round(me ?? 0),
      rank: 30 - Math.round((below / Math.max(1, sorted.length)) * 29) }
  }), [roster, mine])

  const rated = [...roster].map((p) => ({ ...p, ovr: ovrOf(p) })).filter((p) => p.ovr)
    .sort((a, b) => b.ovr - a.ovr).slice(0, 10)

  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>Analytics</h2>
        <p>This is where every rating in the game comes from: 53 metrics across 47 seasons of
          play-by-play, shrunk toward positional priors until each sample stabilises, then turned
          into six skills and an archetype. Hover any of it.</p>
      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="Team profile" note="Rank of 30, minutes-weighted">
          {rows.map((r) => (
            <div key={r.k} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <Tip tip={r.tip}><span style={{ fontSize: 13 }}>{r.label}</span></Tip>
                <span className="mono" style={{ fontSize: 11.5,
                  color: r.rank <= 10 ? 'var(--good)' : r.rank >= 21 ? 'var(--bad)' : 'var(--muted)' }}>
                  #{r.rank} · {r.value}
                </span>
              </div>
              <Bar pct={((30 - r.rank) / 29) * 100}
                color={r.rank <= 10 ? 'var(--good)' : r.rank >= 21 ? 'var(--bad)' : 'var(--acc)'} />
            </div>
          ))}
        </Card>

        <Card title="Rotation" note="By overall">
          {rated.map((p, i) => (
            <PlayerRow key={`${p.uid || p.n}-${i}`} p={p} />
          ))}
        </Card>

        <Card title="How a rating is built" note="No hand-typed numbers">
          <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 13, lineHeight: 1.65 }}>
            <li>Every player-season is scored on 53 metrics over four windows — full season, last
              10, 25 and 75 games — each carrying its own sample size.</li>
            <li>A metric only counts once it stabilises. Until then it is pulled toward a prior
              built from every player at that position, not just the ones who took the shot.</li>
            <li>Six skills come out of the metric groups. A principal-components fit plus a
              seven-cluster mixture assigns the archetype — as a soft membership, so a player can
              be four-fifths of one thing.</li>
            <li>Fit is measured, not asserted: 390 team-seasons, leave-one-season-out, gives the
              matrix that says which archetypes actually work together.</li>
            <li>Games are played possession by possession from those profiles. Nothing about a
              result is written in advance.</li>
          </ol>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- job */

function JobScreen({ save, onLevel, onPreset, onFire, onReset, onQuit }) {
  const rec = save.records
  const conf = save.status.ownerConfidence
  const trust = Math.max(0, Math.min(100, Math.round(50 + conf * 16)))
  // Derived from this roster, this year, rather than looked up in a table of four — which is
  // why almost every club in the league used to open with "make the playoffs, about 44 wins".
  const mandate = useMemo(() => {
    try { return issueMandate(save.franchise.team, save) } catch { return null }
  }, [save.franchise.team, save.picks, save.league])
  return (
    <div className="fo-page">
      <div className="fo-h">
        <h2>The job</h2>
        <p>Ownership hired you for a reason and is keeping score against it. You also decide here
          how much of the work you actually do yourself.</p>
      </div>

      <div className="fo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', marginBottom: 14 }}>
        <Card title="Standing" note={save.status.employed ? 'Employed' : 'Dismissed'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Ring value={trust} label="TRUST" floor={0}
              stroke={trust >= 55 ? 'var(--good)' : trust >= 30 ? 'var(--warn)' : 'var(--bad)'} />
            <div>
              <div style={{ fontSize: 13.5 }}>
                Mandate: <b className="fo-acc">{mandate?.label || SEED.mandates[save.status.mandate]?.label}</b>
              </div>
              <p className="fo-muted" style={{ fontSize: 12.5, margin: '7px 0 0', lineHeight: 1.5 }}>
                {mandate?.primary?.line
                  || `Ownership is measuring you against about ${SEED.mandates[save.status.mandate]?.target ?? 44} wins.`}
              </p>
            </div>
          </div>
          {mandate?.secondaries?.length > 0 && (
            <div className="fo-asks">
              <span className="fo-k">And while you are at it</span>
              {mandate.secondaries.map((o) => (
                <div key={o.id} className="ask">
                  <b>{o.label}</b>
                  <i>{o.detail}</i>
                </div>
              ))}
            </div>
          )}
          <div className="fo-cells" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginTop: 16 }}>
            <div><span className="fo-k">Seasons</span><div className="v">{rec.seasonsCompleted}</div></div>
            <div><span className="fo-k">Record</span><div className="v">{rec.totalWins}–{rec.totalLosses}</div></div>
            <div><span className="fo-k">Titles</span><div className="v">{rec.championships}</div></div>
          </div>
        </Card>

        <Card title="Record book" note={save.gm.name || 'GM'}>
          {[
            ['Playoff appearances', rec.playoffAppearances],
            ['Series won', rec.playoffSeriesWon],
            ['Conference titles', rec.conferenceTitles],
            ['Best season', rec.bestRecord ? `${rec.bestRecord.wins}–${rec.bestRecord.losses} (${rec.bestRecord.season})` : '—'],
            ['Worst season', rec.worstRecord ? `${rec.worstRecord.wins}–${rec.worstRecord.losses} (${rec.worstRecord.season})` : '—'],
            ['Fastest title', rec.fastestTitle ? `${rec.fastestTitle} season${rec.fastestTitle === 1 ? '' : 's'}` : '—'],
            ['Trades made', rec.tradesMade],
          ].map(([k, v]) => (
            <div key={k} className="fo-row">
              <span style={{ fontSize: 13 }}>{k}</span>
              <span className="r"><b style={{ fontSize: 14 }}>{v}</b></span>
            </div>
          ))}
        </Card>

        <Card title="Banners" note={`${(save.badges || []).length} of ${BADGES.length}`}>
          <div style={{ display: 'grid', gap: 8 }}>
            {BADGES.map((b) => {
              const has = (save.badges || []).includes(b.id)
              return (
                <Tip key={b.id} tip={b.blurb} as="div">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px',
                    borderRadius: 5, border: `1px solid ${has ? 'var(--acc)' : 'var(--line)'}`,
                    background: has ? 'color-mix(in srgb,var(--acc) 12%,transparent)' : 'transparent',
                    opacity: has ? 1 : 0.42 }}>
                    <span className="fo-av sm">{has ? '★' : '—'}</span>
                    <span style={{ fontSize: 13 }}>{b.name}</span>
                  </div>
                </Tip>
              )
            })}
          </div>
        </Card>
      </div>

      <ControlSurface preset={save.controlSurface.preset} levels={save.controlSurface.levels}
        onPreset={onPreset} onLevel={onLevel} />

      <div className="fo-verdict" style={{ marginTop: 14 }}>
        <div className="h fo-faint">Leaving</div>
        <div className="d">
          Quitting keeps this career on file — one of three — and hands you back the cabinet.
          Resigning is the other thing: it wipes the roster, the picks and the banners, and
          frees the file for a different club.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <button className="fo-btn sm" type="button" onClick={onQuit}>Quit to your franchises</button>
          <button className="fo-btn danger sm" type="button" onClick={onReset}>Resign and delete</button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- app */

const cloneSeason = (s) => ({
  ...s,
  rec: Object.fromEntries(Object.entries(s.rec).map(([k, v]) => [k, { ...v }])),
  results: s.results.slice(),
})

// A BLACK SCREEN IS NEVER AN ACCEPTABLE FAILURE.
//
// React's default behaviour when a render throws is to unmount the entire tree, and what the
// user sees is nothing at all — no message, no way back, and a career that looks destroyed
// even though it is sitting safely in local storage. That happened, on the click that opens
// the postseason, and the worst part of it was that the report could only ever be "the whole
// screen went black", because the screen had gone black.
//
// So the shell catches it. The career is on disk and untouched; what broke is one component's
// render, and the user gets told which one, gets the error to send on, and gets a button that
// reloads back into the same save. Everything the boundary shows is chosen so that the next
// bug report is actionable.
class Boundary extends Component {
  constructor(props) { super(props); this.state = { err: null, info: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    this.setState({ info })
    try { console.error('[Front Office] render failed', err, info?.componentStack) } catch { /* ignore */ }
  }

  render() {
    const { err, info } = this.state
    if (!err) return this.props.children
    const where = String(info?.componentStack || '').trim().split('\n')[0]?.trim() || 'the page'
    return (
      <div className="fo fo-crash">
        <div className="fo-crash-in">
          <div className="ck">Something broke</div>
          <h2>{where.replace(/^(at|in)\s+/, '') || 'A screen'} could not draw</h2>
          <p>
            Your franchise is safe — it is saved on this device and nothing here touched it.
            This is one screen failing to render, not a lost career.
          </p>
          <pre>{String(err && (err.stack || err.message || err)).slice(0, 900)}</pre>
          <div className="row">
            <button className="fo-btn" type="button" onClick={() => window.location.reload()}>
              Reload and carry on
            </button>
            <button className="fo-btn ghost sm" type="button"
              onClick={() => { try { navigator.clipboard.writeText(String(err?.stack || err)) } catch { /* ignore */ } }}>
              Copy the error
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default function GM() {
  return <Boundary><GMInner /></Boundary>
}

function GMInner() {
  usePageMeta({
    title: 'Front Office — Western Conference Elitists',
    description: 'Run an NBA franchise on real rosters, real contracts and the real CBA.',
  })

  const [save, setSave] = useState(() => loadCareer())
  // Hooks live up here with the rest of them. Placed further down — next to the header strip
  // that uses it — this was a useMemo AFTER the "no career loaded" early return, so React saw
  // a different number of hooks on the two renders and tore the tree down. The new error
  // boundary caught it and named it, which is the first time this codebase has had a render
  // crash report itself instead of going black.
  const liveMandate = useMemo(() => {
    if (!save?.franchise?.team) return null
    try { return issueMandate(save.franchise.team, save) } catch { return null }
  }, [save?.franchise?.team, save?.picks, save?.league])
  // The cabinet, and which file the setup flow is filling. `slots` is state rather than a
  // read-through, because deleting a career has to redraw the menu.
  const [slots, setSlots] = useState(() => franchises())
  const [hiring, setHiring] = useState(null)
  const [quitting, setQuitting] = useState(false)
  // The page-turn card, and the development report that rides along with the one at the
  // end of the year.
  // The player page, and the trail of players you followed to get there. A STACK, because
  // clicking a comp inside a profile is navigation too: back should walk you out the way you
  // came in, and the last back should return you to the screen you started from — which is
  // still mounted underneath with everything you had selected.
  const [trail, setTrail] = useState([])
  const openPlayer = (idOrName) => {
    // Rosters first, then the open market — a free agent is not on anybody's books, so
    // `findPlayer` cannot see him, and a name that looks clickable and does nothing is
    // worse than one that was never clickable.
    const found = findPlayer(idOrName)
      || (poolOf(save) || []).filter((x) => (x.uid || x.n) === idOrName || x.n === idOrName)
        .map((x) => ({ cap: x, sim: x.sim || null, team: null }))[0]
      || null
    if (found) setTrail((t) => [...t, found])
  }
  const backPlayer = () => setTrail((t) => t.slice(0, -1))
  const [chapter, setChapter] = useState(null)
  const [dev, setDev] = useState(null)
  const [screen, setScreenRaw] = useState('home')
  // Going somewhere is recorded, so an objective that asks you to go and look at something
  // can actually tick when you do. It used to read a flag nothing ever set, which teaches
  // the user that the checklist is decorative.
  const setScreen = (k) => {
    setScreenRaw(k)
    setSave((prev) => {
      if (!prev || visited(prev, k)) return prev
      const n = markVisited(prev, k)
      saveCareer(n)
      return n
    })
  }
  const [season, setSeason] = useState(null)
  const [po, setPo] = useState(null)
  const [run, setRun] = useState(null)
  const [report, setReport] = useState(null)
  const [inbox, setInbox] = useState(null)
  const [deadlineDone, setDeadlineDone] = useState(false)
  // All-Star weekend: the object the break was built from, and which contest (if any) the
  // user is currently playing himself.
  // A trade request of your own, waiting for an answer, and the man the desk should open on
  // when you answer it by agreeing to move him.
  const [ask, setAsk] = useState(null)
  const [tradeFocus, setTradeFocus] = useState(null)
  // It is a one-time instruction, not a setting. Left standing, every later visit to the desk
  // would re-open on a man who by then may already have been traded.
  useEffect(() => {
    if (tradeFocus && screen !== 'trades') setTradeFocus(null)
  }, [screen, tradeFocus])
  const [asWk, setAsWk] = useState(null)
  const [asGame, setAsGame] = useState(null)
  const [asEvent, setAsEvent] = useState(null)
  const [offs, setOffs] = useState(null)
  const [auto, setAuto] = useState(0)
  // How far the user asked to get, in THEIR games. The stage targets still hold — the
  // calendar just stops asking permission to cross one when you have already said you
  // want to be at the deadline.
  const [simTarget, setSimTarget] = useState(0)

  // The rotation is career state, and it is applied to the simulation profiles before any
  // game is played — the minutes you set are the load the engine reads, not a preference
  // that gets averaged into something else.
  // A slider moves ONE player and nobody else. The auto-rebalance that used to pay for a
  // change out of everybody else's minutes solved the wrong problem: the arithmetic was
  // never the annoying part, and having four other men shift because you touched one is its
  // own kind of fighting the interface. The total is allowed to be wrong; the screen says
  // so, and "Even it out" is there when you want it.
  const setMinutes = (key, m) => setSave((prev) => {
    const n = { ...prev, rotation: { ...(prev.rotation || {}), [key]: Math.max(0, Math.round(m)) } }
    saveCareer(n)
    return n
  })
  // Spread whatever is over or short across everybody else, in proportion — the old
  // behaviour, on a button, where it belongs.
  const evenOut = () => setSave((prev) => {
    const rs = rosterOf(prev) || []
    const mins = prev.rotation || {}
    const anchor = rs.map((x) => x.uid || x.n).find((k) => (mins[k] || 0) > 0)
    if (!anchor) return prev
    const n = { ...prev, rotation: rebalance(mins, rs, anchor, mins[anchor] || 0) }
    saveCareer(n)
    return n
  })
  const coachRotation = () => setSave((prev) => {
    const rs = rosterOf(prev) || []
    const sm = prev.league?.sim?.[prev.franchise.team] || []
    const n = { ...prev, rotation: autoRotation(rs, sm, bandOf, ratePerMin) }
    saveCareer(n)
    return n
  })
  const [wire, setWire] = useState([])
  const [cast, setCast] = useState(null)
  const [party, setParty] = useState(null)
  const [busy, setBusy] = useState(false)
  // What to explain next. Candidates come from the screen you are on and the state you are
  // in; the first one you have not been told is the one that shows.
  const lessonIds = () => {
    const ids = []
    const st2 = status(teamSalary(rosterOf(save) || []))
    if (screen === 'home') ids.push('mandate')
    if (screen === 'roster') ids.push('archetype', 'badges', 'tendencies')
    if (screen === 'trades') {
      const led = save.picks || {}
      const mineP = (led[save.franchise.team] || [])
      if (mineP.some((p) => p.prot)) ids.push('protection')
      if (mineP.some((p) => p.group)) ids.push('swap')
      ids.push('value', 'matching', 'quality', 'windows', 'surplus', 'stepien')
    }
    if (screen === 'market') ids.push('open_market', 'waivers')
    if (screen === 'draft') ids.push('draft_board', 'scouting', 'pick_value', 'market_price', 'negotiation')
    if (screen === 'finances') ids.push('salary_cap', 'tax')
    if (screen === 'analytics') ids.push('fit')
    if (screen === 'rotation') ids.push('rotation', 'fatigue')
    if (st2.overApron1 || st2.overApron2) ids.unshift('apron')
    if (st2.overTax) ids.push('tax')
    if (offs?.expiring?.length) ids.push('bird_rights')
    return ids
  }
  // ONE LESSON PER VISIT.
  //
  // Dismissing one used to reveal the next immediately — open the trade desk cold and you were
  // taught what a player is worth, then salary matching, then quality, then surplus, four cards
  // deep before you could click anything. Each is worth reading and the pile is not. The screen
  // teaches one thing; go somewhere and come back for the next.
  const [taught, setTaught] = useState(null)
  useEffect(() => { setTaught(null) }, [screen])
  const teachNow = save ? nextLesson(save, lessonIds()) : null
  const teach = taught && taught !== teachNow?.id ? null : teachNow
  // One read of the franchise, shared by every screen that wants to say something about it.
  // Recomputed when the roster, the money, the calendar or the standings move — which is
  // exactly when the answer changes.
  const adv = useMemo(() => {
    if (!save) return null
    try { return advisor(save, { seasonState: season, phase: phaseOf(save).stage }) } catch { return null }
  }, [save, season])
  const voice = save?.advisorVoice || 'tell'
  const setVoice = (v) => setSave((prev) => { const n = { ...prev, advisorVoice: v }; saveCareer(n); return n })
  const gotIt = (id) => { const n = learn(save, id); setSave(n); saveCareer(n) }
  const [wire2, setWire2] = useState([])
  const seasonRef = useRef(null)

  const mine = save?.franchise.team
  const roster = save ? rosterOf(save) : []
  const rating = useMemo(() => teamRating(roster), [roster])

  useEffect(() => { if (save) saveCareer(save) }, [save])

  // The trade code reads situations the way it reads rosters — from a module-level store —
  // so the store has to follow the save, and it has to be set BEFORE anything prices a
  // player. Kept in an effect rather than in the sweep so that a reload restores it too.
  useEffect(() => { setSituations(save?.situations || {}) }, [save?.situations])

  // The season is owned HERE, not by the screen that draws it. Holding it inside
  // SeasonRoom meant every tab change unmounted the component and started the year over —
  // the single worst bug in the first build, and invisible to every test.
  useEffect(() => {
    if (!save || season) return
    const s = newSeason((save.rngSeed + save.records.seasonsCompleted * 7919) >>> 0)
    // A SEASON IS REPRODUCIBLE. It is a seed and a number of games, so the only thing worth
    // persisting is how far through it you are — replaying to that point costs a moment and
    // gives back the exact same standings. Before this, closing the tab in February lost
    // the season while the calendar kept insisting you were at the deadline.
    const done = save.seasonProgress?.played || 0
    if (done > 0 && done <= s.schedule.length) playNext(s, done)
    seasonRef.current = s
    setSeason(s)
    // The draft room is rebuilt the same way — deterministically, from the same save and
    // the same season — so a reload lands you back in it rather than on a dead card.
    if (save.phase === 'offseason' && !offs && done >= s.schedule.length) {
      setTimeout(() => beginOffseason(), 0)
    }
  }, [save, season])

  const push = (html) => setWire((w) => [html, ...w].slice(0, 14))

  // A CHECKPOINT IN THE STORY LAYER.
  //
  // Four moments a year — December, the All-Star break, the deadline, the summer — and each
  // one asks the league whether anybody has had enough. What comes back changes how willing
  // a club is to listen, never what a man is worth, so the whole thing lives beside the
  // valuation rather than inside it.
  //
  // What is new goes on the wire. What is new AND on your own roster stops the season and
  // asks you a question, which is the only part of this the user can lose.
  const runStories = (c, checkpoint) => {
    if (!save || !c) return
    const before = save.situations || {}
    let next
    try {
      next = sweepStories(c, {
        teams: TEAMS,
        rostersOf: (t) => (t === mine ? rosterOf(save) || rostersOf(t) : rostersOf(t)),
        talentOf: talentVorp,
        shopped: save.shopped || {},
        seed: c.seed || 1,
        season: save.records.seasonsCompleted,
        checkpoint,
        existing: before,
      })
    } catch { return }
    const fresh = Object.entries(next).filter(([k]) => !before[k])
    if (!fresh.length) return
    setSave((prev) => {
      if (!prev) return prev
      const n = { ...prev, situations: next }
      saveCareer(n)
      return n
    })
    // Somebody else's problem is a headline; yours is a decision.
    const yours = fresh.filter(([, v]) => v.team === mine && v.state === SITUATION.REQUEST)
    for (const [, v] of fresh) {
      if (yours.some((y) => y[1] === v)) continue
      const club = (CITY[v.team] || [])[1] || v.team
      const line = wireLine(v.name, club, v)
      if (line) push(line.replace(v.name, `<b>${v.name}</b>`))
    }
    // Only a question addressed to the user stops the season. Everything else is news, and
    // news does not interrupt a man who asked to be played to the deadline.
    if (yours.length) {
      setAuto(0)
      setSimTarget(0)
      setAsk({ uid: yours[0][0], sit: yours[0][1] })
    }
  }

  function openDeadline(c, saveOverride) {
    const sv = saveOverride || save
    setDeadlineDone(true)
    if (sv.controlSurface.levels.trades === 'auto') {
      push('<b>Deadline</b> passed quietly — your assistant fielded the calls.')
      return
    }
    // The calls come from the front offices themselves — each one's own targets, its own
    // private read of your roster — with the generic generator as a backstop.
    const r = rng((sv.rngSeed ^ 0x51ed3f) >>> 0)
    const ranks = strengthRanks(c)
    const agentOffers = offersForUser(sv, { r, ranks, year: parseInt(SEED.season, 10), max: 3, intensity: 0.9 })
      .map((o, i) => ({
        id: `fo-${o.team}-${i}`, team: o.team, stance: o.ctx?.label || 'interested',
        want: o.want, give: o.deal.out, givePicks: o.deal.outPicks || [],
        value: 0, target: 0, notes: [], pitch: o.pitch,
      }))
    const offers = agentOffers.length ? agentOffers
      : generateOffers(mine, c, r, sv.picks || newPickLedger(SEED.season),
        parseInt(SEED.season, 10), 4, rosterOf(sv))
    setInbox(offers)
    setScreen('season')
    push(`<b>Trade deadline</b> — ${offers.length} team${offers.length === 1 ? '' : 's'} calling about your roster.`)
  }

  // n counts YOUR games, not the league's. "Play next" that advanced one league game
  // usually left your record untouched — the button did nothing you could see.
  function stepSeason(n, watch = false) {
    const s = seasonRef.current
    if (!s) return
    // Push the chosen minutes into the profiles before the games run, then let what those
    // minutes cost show up in them. Wear is spent here and nowhere else.
    if (save.rotation && controls(save, 'rotations')) {
      const L = save.league
      const mine2 = save.franchise.team
      const rs = rosterOf(save) || []
      const withMinutes = applyRotation(L.sim[mine2] || [], rs, save.rotation)
      L.sim = { ...L.sim, [mine2]:
        applySulk(applyWear(withMinutes, rs, save.wear), rs, save.sulk) }
      setLeague(L)
    }
    const c = cloneSeason(s)
    const opts = watch ? { traceTeam: mine } : undefined
    let myPlayed = teamGames(c, mine).length
    let mine_done = 0
    let hitDeadline = false
    let hitBreak = false
    let hitStory = null
    while (mine_done < n && c.played < c.schedule.length) {
      const [g] = playNext(c, 1, opts)
      if (g && (g.home === mine || g.away === mine)) {
        myPlayed++
        mine_done++
        const won = (g.home === mine ? g.hs : g.as) > (g.home === mine ? g.as : g.hs)
        if (n <= 2) push(`<b>${g.away} ${g.as}</b> at <b>${g.home} ${g.hs}</b>` +
          `${won ? ' — you win' : ' — you lose'}`)
        if (!deadlineDone && myPlayed >= DEADLINE_GAME) { hitDeadline = true; break }
        if (!save.allstarSeen && myPlayed >= ALLSTAR_GAME) { hitBreak = true; break }
        // December: the first time the standings mean anything. Before about twenty-five
        // games a 6-9 start is noise, and men do not ask out of noise.
        //
        // Noted, NOT broken on. A checkpoint that stops the run is a run that halts in the
        // middle of "play to the deadline" with nothing on screen to explain why — which is
        // exactly what it did, and the headless play-through caught it. The sweep happens
        // after the block finishes, and only a question addressed to the user stops anything.
        if (!(save.storiesRun || {}).december && myPlayed >= 25) hitStory = 'december'
      }
    }
    // Your 82 can finish before the league's 1230. The rest of the schedule still has to
    // be played or the standings — and therefore the bracket — are wrong.
    if (myPlayed >= 82 && c.played < c.schedule.length) playNext(c, c.schedule.length - c.played)
    seasonRef.current = c
    setSeason(c)
    // Remember how far in we are, so a reload can replay to exactly here — and spend the
    // minutes just played against the bodies that played them.
    //
    // Computed HERE rather than inside the state updater: an updater has to be pure, and
    // pushing a headline from inside one sets other state mid-reduce. That stalled the
    // whole auto-play loop the first time.
    const spendWear = save.rotation && controls(save, 'rotations') && mine_done > 0
    const nextWear = spendWear
      ? accumulateWear(save.wear, rosterOf(save) || [],
        save.league?.sim?.[save.franchise.team] || [], save.rotation, mine_done)
      : null
    const newlyWorn = nextWear
      ? wornDown(rosterOf(save) || [], nextWear, 10)
        .filter((x) => !(save.warned || {})[x.p.uid || x.p.n])
      : []

    setSave((prev) => {
      if (!prev) return prev
      if (prev.seasonProgress?.played === c.played && !nextWear) return prev
      const n = { ...prev, seasonProgress: { played: c.played } }
      if (nextWear) {
        n.wear = nextWear
        if (newlyWorn.length) {
          n.warned = { ...(prev.warned || {}) }
          for (const x of newlyWorn) n.warned[x.p.uid || x.p.n] = 1
        }
      }
      saveCareer(n)
      return n
    })
    for (const x of newlyWorn) push(`<b>${x.p.n}</b> is ${x.note}.`)

    if (watch && c.last?.trace) {
      const g = c.last
      setCast({ game: { home: g.home, away: g.away, hs: g.hs, as: g.as },
        trace: g.trace, box: g.box })
    }
    // Mark the checkpoint spent before running it, for the same reason the All-Star break
    // is marked on firing: a checkpoint that only closes when the user answers is a
    // checkpoint that fires again on the very next click.
    if (hitStory) {
      setSave((prev) => {
        if (!prev) return prev
        const n = { ...prev, storiesRun: { ...(prev.storiesRun || {}), [hitStory]: true } }
        saveCareer(n)
        return n
      })
      runStories(c, hitStory)
    }
    if (hitDeadline) { setAuto(0); openDeadline(c); runStories(c, 'deadline') }
    // The break stops the season the way the deadline does — the calendar has a hole in it in
    // the middle of February and the game should have one too.
    if (hitBreak) {
      setAuto(0)
      // Marked seen the moment it FIRES, not when the user closes it — exactly the way the
      // deadline works. Hanging it on the close made the break re-fire on every play call
      // after game 57, which is a season that can never reach game 58: the break stopped the
      // loop, the user closed the modal, and the next click stopped it again. A weekend the
      // user walks away from is still a weekend that happened.
      setSave((prev) => {
        if (!prev) return prev
        const n = { ...prev, allstarSeen: true }
        saveCareer(n)
        return n
      })
      runStories(c, 'allstar')
      try {
        const wk = asWeekend(c, mine, ((c.seed || 1) * 31 + c.played) >>> 0)
        setAsWk(wk); setAsGame(null); setAsEvent(null)
        push(`<b>All-Star weekend.</b> ${wk.yoursIn.game.length
          ? `${wk.yoursIn.game.map((x) => x.n).join(' and ')} named` : 'Nobody of yours named'}.`)
      } catch { /* a weekend that cannot be built is not worth stopping the season for */ }
    }
    if (c.played >= c.schedule.length) {
      setAuto(0)
      push('<b>Regular season complete.</b> The bracket is set.')
      // Count the votes once, off the season that was actually played, and keep them on the
      // save — the record book wants them later, and re-counting would be re-deciding.
      let a = null
      try { a = voteAwards(c) } catch { a = null }
      if (a && a.list.length) {
        const light = packAwards(a)
        const won = awardsYours(a, mine)
        setSave((prev) => {
          if (prev.awards) return prev
          const n = { ...prev, awards: light, awardsSeen: false,
            honours: [...(prev.honours || []), { season: SEED.season, hits: won }] }
          saveCareer(n)
          return n
        })
        won.slice(0, 3).forEach((h) => push(`<b>${h.who}</b> — ${h.name}.`))
      }
    }
  }

  // THE BLOCK OF GAMES, AND WHY IT HAS A PULSE.
  //
  // This effect used to hang on `auto` alone: play a chunk, subtract it, let the changed
  // number re-arm the timer. That is a CHAIN, and a chain stops dead if one link fails to
  // move. It failed about half the time — the run would freeze part-way through "play to
  // game 55" with the button still saying "play to game 55", and nothing short of a reload
  // would start it again. The cause is that `auto` is written from two places: this timer
  // subtracts from it, and the long-run effect below sets it from the phase. When those two
  // land in the same commit and agree on the number, React sees no change, skips the
  // re-render, and this effect never re-runs — so no new timer is ever scheduled and the
  // season simply stops.
  //
  // `pulse` is the fix and it is the whole fix: a counter that always increments, so the
  // effect always re-arms whatever `auto` happens to do. The loop still ends the same way it
  // always did, when `auto` reaches zero.
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (auto <= 0) return undefined
    // Bigger chunks mean fewer renders for the same games. A 40-game block used to cost
    // twenty React renders of a large tree; this is a third of that, which is faster on a
    // real machine and stops a slow environment from starving the timer entirely.
    const chunk = Math.max(1, Math.min(auto, Math.ceil(auto / 12)))
    const id = setTimeout(() => {
      stepSeason(chunk)
      setAuto((a) => Math.max(0, a - chunk))
      setPulse((p) => p + 1)
    }, 45)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, pulse])

  // A long run crosses stages by itself. Splitting the season into ten stages was meant to
  // give the year a shape, not to make somebody click through four of them to reach
  // February — so "play to the deadline" plays to the deadline, advancing the calendar on
  // the way and stopping where an actual decision is waiting.
  useEffect(() => {
    if (simTarget <= 0 || !season || auto > 0) return
    const played = teamGames(season, mine).length
    if (played >= simTarget) { setSimTarget(0); return }
    // The decision itself is pure and lives in phase.js, where a test can walk every
    // phase of a season and prove a long run actually terminates. See runStep.
    const step = runStep(save, played, simTarget)
    if (step.do === 'stop') { setSimTarget(0); return }
    if (step.do === 'advance') { advancePhase(); return }
    setAuto(step.n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simTarget, season, auto, save])

  // THE CUP, as a place you visit rather than a thing that happens to you.
  //
  // The bracket lives on the SEASON, not on the save, because it belongs to this year and a
  // reload replays the season from its progress marker — carrying it on the save would mean
  // two copies that disagree. The banner decision is the opposite: it outlives the season, so
  // that goes on the save.
  const [cupOpen, setCupOpen] = useState(false)
  function openCup() {
    const s = seasonRef.current
    if (!s || !cupGroupDone(s)) return
    if (!s.knockout) {
      const q = qualifiers(s.cupGroups, s.cupResults)
      s.knockout = openKnockout(q.byConf)
      setSeason(cloneSeason(s))
    }
    setCupOpen(true)
  }
  function playCup() {
    const s = seasonRef.current
    if (!s?.knockout) return
    const stage = s.knockout.stage
    s.knockout = playCupRound(s, s.knockout)
    setSeason(cloneSeason(s))
    const played = s.knockout.ties.filter((t) => t.round === stage && t.winner)
    played.filter((t) => t.hi === mine || t.lo === mine).forEach((t) => {
      const won = t.winner === mine
      push(`<b>${CUP_NAME} ${cupRoundName(stage).toLowerCase()}</b> — ${won ? 'you beat' : 'you lose to'} `
        + `<b>${won ? t.loser : t.winner}</b> ${Math.max(t.hs, t.as)}–${Math.min(t.hs, t.as)}.`)
    })
    if (s.knockout.champion) {
      push(`<b>${(CITY[s.knockout.champion] || [])[1] || s.knockout.champion}</b> win the ${CUP_NAME}.`)
    }
  }
  function decideBanner(raised) {
    const s = seasonRef.current
    const next = raiseBanner(save, { raised, day: currentDay(s) })
    setSave(next); saveCareer(next)
    push(raised
      ? `<b>The banner goes up.</b> The team plays harder for a fortnight.`
      : `<b>No banner.</b> They are saving it for something bigger.`)
    setCupOpen(false)
  }

  // Opening the bracket no longer plays it. The postseason is a place you go, and the
  // rounds happen one at a time.
  function startPlayoffs() {
    const s = seasonRef.current
    const b = openBracket(s)
    setPo(b)
    setScreen('season')
    push('<b>The postseason begins.</b> Play-in first.')
  }

  const bumpPo = (fn) => {
    setPo((prev) => {
      if (!prev) return prev
      // The bracket is mutated in place by the engine, so a fresh object identity is what
      // tells React anything happened.
      const next = { ...fn(prev) }
      if (next.stage === 'done' && !prev.champion) crownChampion(next)
      else if (next.stage !== prev.stage) {
        const nm = roundName(next.stage)
        if (next.stage !== 'done') push(`<b>${nm}</b> — the field is set.`)
      }
      return next
    })
  }

  function crownChampion(b) {
    const s = seasonRef.current
    const p = bracketResult(b)
    const rn = teamRun(p, mine)
    setRun(rn)
    setReport(seasonReport(save, s, rn))
    push(`<b>${CITY[p.champion][1]}</b> win the championship.`)
    if (rn.champion) {
      push('<b>You won it all.</b> The banner goes up.')
      const rec = s.rec[mine]
      const before = new Set(save.badges || [])
      const earned = BADGES.filter((b) => !before.has(b.id) && (b.id === 'champion'
        || (b.id === 'quick_build' && save.records.seasonsCompleted <= 2)))
      setParty({ season: save.franchise.currentSeason, record: `${rec.w}–${rec.l}`,
        path: rn.path, badges: earned })
    }
  }

  function executeTrade(deal) {
    const next = applyTrade(save, deal)
    // A man who has been moved has no grievance left with you. His situation, his sulk and
    // the record that you shopped him all leave with him — otherwise a player you traded
    // away in November is still costing you production in March, and the sweep in February
    // is still angry on behalf of somebody on another roster.
    const gone = new Set((deal.out || []).map((p) => p.uid || p.n))
    if (gone.size) {
      const drop = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !gone.has(k)))
      next.situations = drop(next.situations)
      next.sulk = drop(next.sulk)
      next.shopped = drop(next.shopped)
    }
    setSave(next)
    saveAndSync(next)
    push(`<b>Trade</b> — ${mine} send ${deal.out.map((p) => p.n).join(', ') || 'picks'} to ` +
      `${deal.other} for ${deal.inc.map((p) => p.n).join(', ') || 'picks'}.`)
  }

  function acceptOffer(o) {
    executeTrade({ other: o.team, out: [o.want], inc: o.give, outPicks: [], inPicks: o.givePicks })
    setInbox((cur) => (cur || []).filter((x) => x.id !== o.id))
  }

  function beginOffseason() {
    const s = seasonRef.current
    const r = rng((save.rngSeed + (save.records.seasonsCompleted + 1) * 7919) >>> 0)
    const year = parseInt(save.franchise.currentSeason, 10) + 1
    // What camp bought, then a year of aging. A summer heals most of what the season cost.
    const practised = applyPractice(save.league.rosters[mine], save.camp?.emphasis)
    const aged = ageRoster(save.league.sim[mine], practised, save.records.seasonsCompleted, r)
    // Who the year made better and who it used up. Measured against what the age said
    // should happen, so a 34-year-old losing half a point reads as normal and a
    // 21-year-old gaining half a point does too.
    const development = developmentReport(save.league.rosters[mine], aged.cap)
    setDev(development)
    const { kept, expiring } = runContracts(aged.cap)
    const worstFirst = TEAMS.slice().sort((a, b) =>
      (s.rec[a].w - s.rec[b].w) ||
      ((s.rec[a].pf - s.rec[a].pa) - (s.rec[b].pf - s.rec[b].pa)) || a.localeCompare(b))
    const lot = runLottery(worstFirst, r)
    const cls = enrich(generateClass(r, 60, year), r)
    const board = scoutWithStaff(cls, save.scouts || [], r, { workouts: save.workouts || {} })
    const draftRes = runDraft(lot, cls, r, mine)
    const ranks = strengthRanks(s)
    const talks = {}, negs = {}
    // Kept on the offseason state so the negotiation screen can price your own club the
    // same way it prices everybody else's.
    for (const p of expiring) {
      const sim = aged.sim.find((x) => x.n === p.n) || null
      const market = marketPrice(p.v ?? 0, p.a ?? 27, p.mpg ?? 20, p.exp ?? 5)
      const neg = new Negotiation({
        name: p.n, market, personality: makePersonality(r, p.a ?? 27),
        teamWins: s.rec[mine].w, r,
        rivals: rivalOffers({ ...p, team: mine }, market, r, ranks),
      })
      negs[p.uid] = { neg, sim }
      talks[p.uid] = { ask: neg.ask, state: 'open',
        message: `His agent opens at ${money(neg.ask)} a year.` }
    }
    // A new draft is a new scouting cycle: last year's workouts do not carry.
    //
    // Functional update, deliberately: `save` here is the value captured when this handler
    // was created, and the phase advance that called us has already moved the career on.
    // Spreading the stale copy put the calendar back to the exit interviews and the whole
    // year stalled there.
    setSave((prev) => { const n = { ...prev, workouts: {} }; saveCareer(n); return n })
    // The rest of the league runs its year here — aging, retirements, the draft — and its
    // free agents go ON THE MARKET rather than being signed behind your back before you
    // ever see the screen.
    const opened = openFreeAgency({ ...save, league: save.league }, {
      r, year, yearIndex: save.records.seasonsCompleted, draftPicks: draftRes.picks,
    })
    setLeague(opened.league)
    setSave((prev) => { const n = { ...prev, league: opened.league }; saveCareer(n); return n })
    for (const d of opened.retired.filter((x) => x.reason === 'retired').slice(0, 3)) {
      push(`<b>${d.name}</b> retires at ${Math.round(d.age)}.`)
    }

    setOffs({
      r, year, aged, kept, expiring, lot, board, draftRes, cls, ranks, development,
      pool: opened.pool, faOffers: {}, faDone: false, faResult: null,
      taken: new Set(draftRes.taken), made: {}, talks, negs, additions: [],
      nextLabel: `${year}-${String((year + 1) % 100).padStart(2, '0')}`,
    })
    setScreen('draft')
    // The year's page turns here, with the development report on the card: this is the one
    // chapter break where what happened to your players IS the news.
    const ch = chapterOf(save, 'review', 'offseason', {
      ...phaseCtx, trades: save.records?.tradesMade || 0,
      risers: development.risers, fallers: development.fallers,
    })
    if (ch) setChapter(ch)
    push(`<b>${CITY[lot[0]][1]}</b> win the lottery.`)
  }

  // Hiring changes what you can see, so the board is rebuilt the moment the staff does.
  function rebuildBoard(next) {
    setOffs((o) => (o ? { ...o,
      board: scoutWithStaff(o.cls, next.scouts || [], o.r, { workouts: next.workouts || {} }),
    } : o))
  }
  function hireScout(sc) {
    if (payroll(save.scouts || []) + sc.salary > SCOUT_BUDGET) return
    const next = { ...save, scouts: [...(save.scouts || []), sc] }
    setSave(next); saveCareer(next); rebuildBoard(next)
    push(`<b>${mine}</b> hire ${sc.name} — ${describeScout(sc)}.`)
  }
  function fireScout(sc) {
    const next = { ...save, scouts: (save.scouts || []).filter((x) => x.id !== sc.id) }
    setSave(next); saveCareer(next); rebuildBoard(next)
  }
  function workoutProspect(p) {
    const w = { ...(save.workouts || {}) }
    w[p.id] = (w[p.id] || 0) + 1
    const next = { ...save, workouts: w }
    setSave(next); saveCareer(next); rebuildBoard(next)
    push(`<b>${mine}</b> work out ${p.name} (${p.school}).`)
  }

  // Bid on somebody else's free agent. What you are allowed to say is decided by the cap.
  function offerTo(p, salary, years) {
    setOffs((o) => (o ? { ...o, faOffers: { ...o.faOffers, [p.uid]: { salary, years } } } : o))
  }
  function withdrawOffer(p) {
    setOffs((o) => {
      if (!o) return o
      const next = { ...o.faOffers }
      delete next[p.uid]
      return { ...o, faOffers: next }
    })
  }
  function openMarket() {
    if (!offs || offs.faDone) return
    const res = resolveFreeAgency({ ...save, league: save.league }, {
      r: offs.r, pool: offs.pool, year: offs.year, offers: offs.faOffers,
    })
    setLeague(res.league)
    const next = { ...save, league: res.league }
    setSave(next); saveCareer(next)
    setOffs((o) => (o ? { ...o, faDone: true, faResult: res } : o))
    for (const n of res.news) push(n)
    for (const m of res.mine) {
      push(`<b>${mine}</b> sign ${m.player.n} — ${money(m.salary)} for ${m.years} year${m.years === 1 ? '' : 's'}.`)
    }
    if (!res.mine.length && Object.keys(offs.faOffers).length) {
      push('<b>Free agency</b> — you were outbid on everyone you went after.')
    }
  }

  function draftPlayer(pick, prospect) {
    setOffs((o) => {
      const taken = new Set(o.taken); taken.add(prospect.id)
      const made = { ...o.made, [pick.overall]: prospect }
      // If a later pick had him on its card, that team now takes the next name instead.
      const picks = o.draftRes.picks.map((x) => ({ ...x }))
      const i = picks.findIndex((x) => x.prospect && x.prospect.id === prospect.id)
      if (i >= 0) {
        const used = new Set(picks.filter((x) => x.prospect).map((x) => x.prospect.id))
        Object.values(made).forEach((p) => used.add(p.id))
        picks[i].prospect = o.board.find((p) => !used.has(p.id)) || null
      }
      return { ...o, taken, made, draftRes: { ...o.draftRes, picks },
        additions: [...o.additions, labelRookie(rookieContract(prospect, pick.overall, o.r))] }
    })
    push(`<b>${mine}</b> select ${prospect.name} at #${pick.overall}.`)
  }

  function negotiate(p, aav, years) {
    const { neg, sim } = offs.negs[p.uid]
    // Your club is measured on the same scale as the twenty-nine bidding against you. A
    // flat 0.5 here meant winning sixty games bought you nothing at the table.
    const pull = appealOf(mine, offs.ranks || strengthRanks(null))
    // And his role: how big a part of this team he actually is, by minutes, rather than a
    // constant. A starter hears a different offer from the twelfth man.
    const mins = (save.rotation || {})[p.uid || p.n]
    const role = Math.max(0.2, Math.min(0.95, (mins ?? p.mpg ?? 20) / 34))
    const res = neg.offer({ aav, years, role, ...pull, incumbent: true })
    const tone = res.result === 'signed' ? 'good'
      : (res.result === 'walked' || res.result === 'lost' || res.result === 'insulted') ? 'bad' : undefined
    setOffs((o) => ({
      ...o,
      talks: { ...o.talks, [p.uid]: { ask: neg.ask, state: neg.state, message: res.message, tone } },
      additions: res.result === 'signed' ? [...o.additions, reSign(p, sim, aav, years)] : o.additions,
    }))
    if (res.result === 'signed') push(`<b>${p.n}</b> re-signs with ${mine} — ${short(aav)} × ${years}.`)
    if (res.result === 'lost') push(`<b>${p.n}</b> leaves for ${res.to}.`)
  }

  function letGo(p) {
    setOffs((o) => ({ ...o, talks: { ...o.talks, [p.uid]:
      { ask: o.talks[p.uid].ask, state: 'walked', tone: 'bad', message: 'You told his agent no.' } } }))
  }

  function finishOffseason() {
    // The market cannot still be open when the year closes.
    if (offs && !offs.faDone) openMarket()
    const s = seasonRef.current
    if (!s || !offs) {
      // Nothing to close — the room was never opened in this session. Reopen it rather
      // than throwing, or if even the season is gone, let the calendar move on.
      if (s && !offs) { beginOffseason(); return }
      setPhase('camp')
      setScreen('home')
      return
    }
    const rec = s.rec[mine]
    // Free agents you won in the market are additions like a draft pick is.
    const won = (offs.faResult?.mine || []).map((m) => ({
      cap: { ...m.player, s: m.salary, yr: m.years, o: null, uid: `${mine}-fa-${offs.year}-${m.player.n}` },
      sim: (save.league.sim[m.player.from] || []).find((x) => x.n === m.player.n) || null,
    }))
    const filled = refill(offs.aged.sim, offs.kept, [...offs.additions, ...won], offs.r, offs.year, 14)
    const next = rollSeason(save, {
      season: save.franchise.currentSeason, wins: rec.w, losses: rec.l, seed: s.seed,
      run: run || { made: false, seriesWon: 0, confTitle: false, champion: false },
      pf: rec.pf, pa: rec.pa,
    })
    next.league = { ...save.league,
      rosters: { ...save.league.rosters, [mine]: filled.cap },
      sim: { ...save.league.sim, [mine]: filled.sim } }
    // A new year: back to training camp, with the season counter reset. Set BEFORE the
    // save is written, or the persisted copy carries last season's progress.
    next.phase = 'camp'
    next.seasonProgress = { played: 0 }
    next.camp = {}
    // Last season's ballot and last season's All-Star break do not belong to this one.
    // rollSeason deep-copies the save, so anything left here survives the summer — and the
    // awards writer refuses to overwrite an existing ballot, which meant that until this
    // line existed a career counted its votes once, in year one, and never again.
    next.awards = null
    next.awardsSeen = false
    next.allstarSeen = false
    // The season's stories end with the season. A man who asked out and was kept comes back
    // through December's sweep on the same facts that made him ask — angrier, because
    // "shopped and not moved" is now true of him.
    next.situations = clearStories(save.situations || {})
    next.storiesRun = {}
    // The dialog promises the penalty lasts "the rest of the season", so it lasts the rest of
    // the season. He comes back in October a professional again — and, because being shopped
    // and kept survives the summer below, angrier at the first checkpoint.
    next.sulk = {}
    next.shopped = Object.fromEntries(Object.entries(save.shopped || {})
      .filter(([, v]) => v && v.extended))
    // A summer off heals most of it, but a season ridden hard still leaves something.
    next.wear = Object.fromEntries(Object.entries(save.wear || {})
      .map(([k, v]) => [k, Math.max(0, v * 0.25)]).filter(([, v]) => v > 0.5))
    next.warned = {}
    setLeague(next.league)
    setSave(next)
    saveAndSync(next)
    seasonRef.current = null
    setSeason(null); setPo(null); setRun(null); setReport(null)
    setInbox(null); setDeadlineDone(false); setOffs(null); setParty(null); setScreen('home')
    if (!next.status.employed) push('<b>You have been fired.</b>')
  }

  // Walking out. Every piece of derived state has to go with it — the season, the bracket,
  // the open offseason, the inbox — or the next career you open inherits the last one's
  // playoff bracket, which is exactly the class of bug that made the league feel frozen.
  const leaveToMenu = (destroy) => {
    if (destroy) { deleteFranchise(save.slot) } else { saveCareer(save); leaveCareer() }
    setQuitting(false)
    setSave(null)
    seasonRef.current = null
    setSeason(null); setPo(null); setRun(null); setReport(null); setInbox(null)
    setDeadlineDone(false); setOffs(null); setParty(null); setCast(null)
    setAsWk(null); setAsGame(null); setAsEvent(null); setAsk(null); setTradeFocus(null)
    setAuto(0); setSimTarget(0); setWire([]); setWire2([])
    setScreen('home')
    setHiring(null)
    setSlots(franchises())
  }

  if (!save) {
    const openSlot = (n) => {
      const c = loadCareer(n)
      if (!c) { setSlots(franchises()); return }
      setSave(c)
      setScreen('home')
    }
    return (
      <div className="fo" style={themeVars(hiring ? 'OKC' : 'OKC')}>
        {hiring
          ? <Hiring slot={hiring} onCancel={() => { setHiring(null); setSlots(franchises()) }}
              onHire={(cfg) => {
                const c = newCareer(cfg)
                setSave(c); saveCareer(c); setHiring(null); setSlots(franchises()); setScreen('home')
              }} />
          : <FranchiseMenu slots={slots} onOpen={openSlot} onNew={(n) => setHiring(n)}
              onDelete={(n) => { deleteFranchise(n); setSlots(franchises()) }} />}
      </div>
    )
  }

  const games = season ? teamGames(season, mine).length : 0
  const phase = phaseOf(save)
  const phaseCtx = {
    season, games, po, report, wire: wire2,
    inboxCount: inbox?.length || 0,
    inboxHandled: deadlineDone && !inbox,
    record: season ? `${season.rec[mine].w}–${season.rec[mine].l}` : null,
    // `ready` is the honest flag: the offseason objectives mean nothing until the draft
    // room has actually been opened, and a reload leaves the phase persisted but the room
    // closed.
    ready: !!offs,
    drafted: offs ? !offs.draftRes.picks.some((p) => p.userPick && !offs.made[p.overall]) : false,
    faSettled: offs ? offs.expiring.every((p) => offs.talks[p.uid]?.state !== 'open') : false,
    expiring: offs ? offs.expiring.length : 0,
    pickNo: offs ? (offs.draftRes.picks.find((p) => p.userPick) || {}).overall : null,
  }

  // A round of league business between phases: the other twenty-nine front offices work
  // their own phones, on their own private valuations, and the league changes shape
  // whether or not you did anything.
  function leagueRound(next, window = 'quiet') {
    const r = rng((next.rngSeed ^ (PHASES.indexOf(phaseOf(next)) * 7919)) >>> 0)
    const ranks = strengthRanks(season)
    // The window decides both how busy the league is and how big a name can move. Stars
    // change teams in February and in July, not on a Tuesday in November.
    const deals = runMarket(next, { r, ranks, year: parseInt(SEED.season, 10), window })
    let out = coolDown(next)
    for (const d of deals) out = applyLeagueTrade(out, d)
    out = refillLeague(out, r, parseInt(SEED.season, 10))
    // The other twenty-nine work the open market too. A club that comes out of a trade a
    // man short signs somebody the same week, which is what stops the league quietly
    // playing shorthanded for four months.
    out = cpuFillFromPool(out, r)
    for (const n of (out.poolNews || [])) push(n)
    // Ownership can have moved without anybody trading: a protection or a swap is settled
    // by the standings, so the ledger is rebuilt every time the calendar turns a page.
    out = { ...out, picks: rebuildLedger(out.picks, ranks) }
    if (deals.length) {
      setWire2((w) => [...deals.map((d) => d.text), ...w].slice(0, 12))
      deals.forEach((d) => push(`<b>Trade</b> — ${d.text}`))
    }
    return out
  }

  // One place that moves the calendar, and it PERSISTS. Phase changes that only lived in
  // React state were lost on reload — you would come back to the app and find yourself
  // replaying a stage you had already finished.
  function setPhase(key) {
    setSave((prev) => { const n = { ...prev, phase: key }; saveCareer(n); return n })
  }

  // Every phase change goes through here, so nothing can turn the page silently.
  function turnPage(fromKey, toKey, extra = {}) {
    const ch = chapterOf(save, fromKey, toKey, {
      ...phaseCtx,
      trades: save.records?.tradesMade || 0,
      emphasis: save.camp?.emphasis,
      ...extra,
    })
    if (ch) setChapter(ch)
  }

  function advancePhase() {
    const key = phase.key
    setBusy(true)
    try {
      if (key === 'camp' || key === 'preseason') {
        const next = leagueRound({ ...save, phase: nextPhase(key).key },
          key === 'camp' ? 'offseason' : 'quiet')
        setSave(next); saveCareer(next)
        turnPage(key, nextPhase(key).key)
        if (key === 'preseason') setScreen('season')
        return
      }
      // The button that says "play to game 25" plays to game 25 — it does not merely walk
      // you to a screen with another button on it.
      if (phase.games && games < phase.games) {
        setScreen('season')
        setAuto(phase.games - games)
        return
      }
      if (key === 'early' || key === 'cup') {
        const next = leagueRound({ ...save, phase: nextPhase(key).key }, 'quiet')
        setSave(next); saveCareer(next); setScreen('season')
        turnPage(key, nextPhase(key).key)
        return
      }
      if (key === 'midseason') {
        // The deadline comes to you rather than being a place you happen to stop.
        const next = { ...save, phase: 'deadline' }
        setSave(next); saveCareer(next); setScreen('season')
        turnPage('midseason', 'deadline')
        if (!inbox) openDeadline(seasonRef.current, next)
        return
      }
      if (key === 'deadline') {
        const next = leagueRound({ ...save, phase: 'stretch' }, 'deadline')
        setInbox(null)
        setSave(next); saveCareer(next); setScreen('season')
        turnPage('deadline', 'stretch')
        return
      }
      if (key === 'stretch') { setPhase('postseason'); setScreen('season'); turnPage('stretch', 'postseason'); return }
      if (key === 'postseason') {
        if (!po) { startPlayoffs(); return }
        // You cannot leave the postseason before it has finished. It used to be one click
        // from the bracket to the exit interviews.
        if (po.stage !== 'done') { setScreen('season'); return }
        setPhase('review'); setScreen('report')
        turnPage('postseason', 'review', { champion: CITY[po.champion]?.[1] || po.champion })
        return
      }
      if (key === 'review') {
        setPhase('offseason')
        beginOffseason()
        return
      }
      if (key === '__never') return
      if (key === 'offseason') { finishOffseason(); return }
    } finally {
      setBusy(false)
    }
  }

  const tot = teamSalary(roster)
  const st = status(tot)
  const strip = {
    mandate: liveMandate?.label || SEED.mandates[save.status.mandate]?.label || 'Compete',
    payroll: tot,
    status: statusLabel(st),
    payrollTip: `Cap ${short(CBA.cap)} · tax ${short(CBA.tax)} · first apron ${short(CBA.apron1)} · ` +
      `second apron ${short(CBA.apron2)}. You are ${statusLabel(st).toLowerCase()}.`,
    trust: Math.max(0, Math.min(100, Math.round(50 + save.status.ownerConfidence * 16))),
    season: save.franchise.currentSeason,
    // The real date, not the phase's label. The label was a fixed string per stage, so the
    // strip insisted it was December the twenty-fifth for the entire run from Christmas to
    // February while the league played on into the new year. The season has known the date
    // of every game since the schedule gained a calendar; this is it finally saying so.
    phase: `${phase.name} · ${season && season.played > 0
      ? dateLabel(calToday(season).date) : phase.date}`,
    // The advance button lives in the top strip as well as on the card, so the calendar is
    // always one click away no matter which screen you wandered onto.
    // While the bracket is open the calendar cannot move, and the strip should say so
    // rather than offering a button that does nothing.
    advance: busy ? 'Working…'
      : (po && phase.key === 'postseason' && po.stage !== 'done')
        ? `${roundName(po.stage)} in progress`
        : phase.games && games < phase.games ? `Play to game ${phase.games}` : phase.next,
    advanceDisabled: busy || !canAdvance(save, phaseCtx).ok
      || !!(po && phase.key === 'postseason' && po.stage !== 'done'),
    advanceWhy: (po && phase.key === 'postseason' && po.stage !== 'done')
      ? 'The postseason runs round by round. Finish it and the calendar moves on.'
      : canAdvance(save, phaseCtx).ok
        ? `Next: ${nextPhase(phase.key).name} · ${nextPhase(phase.key).date}`
        : `${canAdvance(save, phaseCtx).blocking[0].text} first.`,
    // WHY THE BUTTON IS DEAD, WHERE THE BUTTON IS.
    //
    // The reason has always existed and has always been correct. It was hung on a tooltip
    // attached to the four-grey-letter word "Next" above the button — a label nobody has
    // any reason to point at, and nothing at all on a touch screen. So the largest control
    // on the offseason, the most complex screen in the game, read as simply broken: you
    // press START THE NEW SEASON and nothing happens, with the explanation parked on the
    // one pixel you would never visit. The phase card carries the same line, but on this
    // screen it is a long way below the fold.
    advanceBlock: (po && phase.key === 'postseason' && po.stage !== 'done')
      ? roundName(po.stage)
      : canAdvance(save, phaseCtx).ok ? null : canAdvance(save, phaseCtx).blocking[0].text,
    onAdvance: advancePhase,
    market: SEED.teams[mine]?.market ?? 0,
  }

  const news = wire.length ? wire : [
    `<b>${CITY[mine][1]}</b> hire ${save.gm.name} as general manager.`,
    `Payroll sits at <b>${short(tot)}</b> — ${statusLabel(st).toLowerCase()}.`,
    'Every contract, cap rule and rating in this game is real.',
  ]

  const badges = {
    season: inbox?.length || 0,
    draft: offs ? offs.expiring.filter((p) => offs.talks[p.uid]?.state === 'open').length : 0,
  }

  return (
    <PlayerLink.Provider value={openPlayer}>
    <div className="fo" style={themeVars(mine)}>
      <Shell save={save} screen={screen} setScreen={setScreen} strip={strip} news={news}
        badges={badges} onQuit={() => setQuitting(true)}>
        {teach && <Lesson lesson={teach} onGot={(id) => { setTaught(id); gotIt(id) }} />}
        {screen === 'home' && (
          <HomeScreen save={save} roster={roster} rating={rating} onGo={setScreen}
            phaseCtx={phaseCtx} busy={busy} adv={adv} voice={voice} onVoice={setVoice}
            onAdvance={advancePhase}
            onCamp={(patch) => { const n = { ...save, camp: { ...save.camp, ...patch } }; setSave(n); saveCareer(n) }} />
        )}
        {screen === 'roster' && <RosterScreen roster={roster} sim={save.league?.sim?.[mine]} needs={adv?.needs} />}
        {screen === 'rotation' && (
          <RotationScreen roster={roster} sim={save.league?.sim?.[mine]}
            minutes={save.rotation || {}} wear={save.wear || {}}
            onSet={setMinutes} onAuto={coachRotation} onEven={evenOut} />
        )}
        {screen === 'trades' && (
          <TradeScreen save={save} onExecute={executeTrade} needs={adv?.needs} focus={tradeFocus}
            onShopped={(players) => setSave((prev) => {
              if (!prev) return prev
              const sh = { ...(prev.shopped || {}) }
              for (const p of players) {
                const k = p.uid || p.n
                sh[k] = { ...(sh[k] || {}), count: ((sh[k] || {}).count || 0) + 1, unmoved: true }
              }
              const n = { ...prev, shopped: sh }
              saveCareer(n)
              return n
            })}
            onStance={(k) => setSave((prev) => {
              const n = { ...prev, stance: k }; saveCareer(n); return n
            })} />
        )}
        {screen === 'market' && (
          <MarketScreen save={save} roster={roster} needs={adv?.needs}
            onSign={(p, terms) => { const n = signFromPool(save, p, terms); setSave(n); saveCareer(n)
              setLeague(n.league); push(`<b>${p.n}</b> signs with ${mine}.`) }}
            onWaive={(p) => { const n = waiveToPool(save, p); setSave(n); saveCareer(n)
              setLeague(n.league); push(`${mine} waive <b>${p.n}</b>.`) }} />
        )}
        {screen === 'season' && po && phase.key === 'postseason' && (
          <PostseasonScreen save={save} po={po} run={run} report={report}
            onStep={() => bumpPo(stepBracket)}
            onRound={() => bumpPo(playRound)}
            onSeries={(sr) => bumpPo((b) => playThisSeries(b, sr))}
            onFinish={advancePhase} />
        )}
        {screen === 'season' && season && !(po && phase.key === 'postseason') && (
          <SeasonScreen save={save} season={season} po={po} run={run} report={report}
            inbox={inbox} auto={auto} phase={phase} phaseCtx={phaseCtx} onAdvance={advancePhase}
            onWatch={() => stepSeason(1, true)}
            onPlay={(n) => (n === 1 ? stepSeason(1) : setAuto(n))}
            onStop={() => { setAuto(0); setSimTarget(0) }}
            onRun={(target) => setSimTarget(target)}
            onPlayoffs={startPlayoffs}
            onCup={openCup}
            onAccept={acceptOffer}
            onPass={(o) => setInbox((cur) => (o ? (cur || []).filter((x) => x.id !== o.id) : null))}
            onRoll={beginOffseason} />
        )}
        {screen === 'draft' && (
          <OffseasonScreen save={save} offs={offs} onDraft={draftPlayer}
            onHire={hireScout} onFire={fireScout} onWorkout={workoutProspect}
            onOffer={offerTo} onWithdraw={withdrawOffer} onMarket={openMarket}
            onNegotiate={negotiate} onLetGo={letGo} onFinish={finishOffseason} />
        )}
        {screen === 'finances' && <FinancesScreen save={save} roster={roster} />}
        {screen === 'report' && <ReportScreen save={save} roster={roster} />}
        {screen === 'job' && (
          <JobScreen save={save}
            onPreset={(k) => setSave({ ...save, controlSurface: { preset: k, levels: { ...SEED.presets[k].levels } } })}
            onLevel={(k, v) => setSave({ ...save, controlSurface: {
              preset: 'custom', levels: { ...save.controlSurface.levels, [k]: v } } })}
            onReset={() => leaveToMenu(true)}
            onQuit={() => setQuitting(true)} />
        )}
      </Shell>
      {trail.length > 0 && (
        <PlayerProfile entry={trail[trail.length - 1]} depth={trail.length} mine={mine}
          onBack={backPlayer} onOpen={openPlayer} />
      )}
      {cupOpen && season?.knockout && (
        <CupNight season={season} kn={season.knockout} mine={mine}
          onPlay={playCup} onBanner={decideBanner} onClose={() => setCupOpen(false)} />
      )}
      {ask && (
        <TradeRequest ask={ask} save={save} mine={mine}
          player={(rosterOf(save) || []).find((p) => (p.uid || p.n) === ask.uid)}
          talkOdds={talkdownChance({
            heat: ask.sit.heat ?? 0.5,
            contention: season ? Math.max(0, Math.min(1,
              (season.rec[mine].w / Math.max(1, season.rec[mine].w + season.rec[mine].l) - 0.35) / 0.35)) : 0.4,
            trust: Math.max(0, Math.min(100, Math.round(50 + save.status.ownerConfidence * 16))),
          })}
          onTrade={() => {
            // He goes ON THE BLOCK, and into the outgoing side of the builder. The button
            // says the desk opens with him on the block, so it does.
            setAsk(null)
            setTradeFocus(ask.uid)
            setScreen('trades')
            push(`<b>${ask.sit.name}</b> has asked to be traded. His price around the league has moved.`)
          }}
          onTalk={() => {
            const odds = talkdownChance({
              heat: ask.sit.heat ?? 0.5,
              contention: season ? Math.max(0, Math.min(1,
                (season.rec[mine].w / Math.max(1, season.rec[mine].w + season.rec[mine].l) - 0.35) / 0.35)) : 0.4,
              trust: Math.max(0, Math.min(100, Math.round(50 + save.status.ownerConfidence * 16))),
            })
            // One draw, seeded off the save and the man, so reloading cannot re-roll it.
            const won = rng(((save.rngSeed || 1) ^ ask.uid.length * 7919
              ^ (save.records.seasonsCompleted * 104729)) >>> 0).rand() < odds
            setSave((prev) => {
              if (!prev) return prev
              const sits = { ...(prev.situations || {}) }
              if (won) sits[ask.uid] = { ...sits[ask.uid], state: SITUATION.COMMITTED }
              const n = { ...prev, situations: sits }
              saveCareer(n)
              return n
            })
            push(won
              ? `<b>${ask.sit.name}</b> has agreed to stay — for now.`
              : `<b>${ask.sit.name}</b> heard you out and still wants out.`)
            setAsk(null)
          }}
          onRefuse={() => {
            setSave((prev) => {
              if (!prev) return prev
              const n = { ...prev,
                sulk: { ...(prev.sulk || {}), [ask.uid]: REFUSAL_PENALTY },
                shopped: { ...(prev.shopped || {}),
                  [ask.uid]: { ...(prev.shopped || {})[ask.uid], count: 1, unmoved: true } } }
              saveCareer(n)
              return n
            })
            push(`${mine} tell <b>${ask.sit.name}</b> he is not going anywhere.`)
            setAsk(null)
          }} />
      )}
      {asWk && (
        <AllStarNight wk={asWk} game={asGame} mine={mine} event={asEvent}
          onEvent={(k) => setAsEvent(k)}
          onEventDone={(res) => {
            // Your own round replaces the one the CPU shot for him, so the board the user
            // sees on the way out is the board he actually produced.
            setAsWk((prev) => {
              if (!prev) return prev
              const key = asEvent === 'three' ? 'threeScores' : 'dunkScores'
              const me = prev.yoursIn[asEvent][0]
              return { ...prev, [key]: prev[key].map((x) => (x.who.id === me.id
                ? { ...x, total: res.total, score: Math.round(res.total / 2) } : x)) }
            })
            if (res.won) push(`<b>${asWk.yoursIn[asEvent][0].n}</b> wins the ${
              asEvent === 'three' ? 'three-point shootout' : 'dunk contest'}.`)
            setAsEvent(null)
          }}
          onClose={() => {
            if (!asGame) {
              const g = asPlayGame(asWk.squads, rng((asWk.seed ^ 0x9a51) >>> 0))
              setAsGame(g)
              push(`<b>${g.winner} ${g.winner === 'East' ? g.east : g.west}</b>, ${
                g.winner === 'East' ? 'West' : 'East'} ${g.winner === 'East' ? g.west : g.east}` +
                `${g.mvp ? ` — <b>${g.mvp.n}</b> takes the MVP.` : '.'}`)
              return
            }
            setAsWk(null); setAsEvent(null)
          }} />
      )}
      {save.awards && !save.awardsSeen && (
        <AwardsNight awards={save.awards} mine={mine}
          onDone={() => setSave((prev) => {
            const n = { ...prev, awardsSeen: true }; saveCareer(n); return n
          })} />
      )}
      {chapter && (
        <ChapterCard ch={chapter} dev={chapter.openingKey === 'offseason' ? dev : null}
          onGo={() => setChapter(null)} />
      )}
      {quitting && (
        <QuitDialog save={save} onCancel={() => setQuitting(false)}
          onSave={() => leaveToMenu(false)} onDelete={() => leaveToMenu(true)} />
      )}
      {cast && (
        <GameCast game={cast.game} trace={cast.trace} box={cast.box} mine={mine}
          onDone={() => setCast(null)} />
      )}
      {party && (
        <Celebration team={mine} season={party.season} record={party.record}
          path={party.path} badges={party.badges} onDone={() => setParty(null)} />
      )}
    </div>
    </PlayerLink.Provider>
  )
}
