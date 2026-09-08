// The GM. A flat-vector bust rendered as a front-office ID portrait — every feature is a
// parameter, so the same object serialises into the save file and re-renders identically.
// The palettes and defaults live in gmProfile.js so the save layer can read them without
// importing a React component.
export {
  SKIN, HAIR_COLOR, SUIT, SHIRT, TIE, HAIR_STYLES, FACIAL, GLASSES, DEFAULT_GM, randomGM,
} from './gmProfile.js'
import {
  SKIN, HAIR_COLOR, SUIT, SHIRT, TIE, HAIR_STYLES, FACIAL, GLASSES, DEFAULT_GM,
} from './gmProfile.js'

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v + amt)))
  )
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export default function Avatar({ gm = DEFAULT_GM, size = 120, className = '', title }) {
  const skin = SKIN[gm.skin] ?? SKIN[2]
  const hairC = HAIR_COLOR[gm.hairColor] ?? HAIR_COLOR[0]
  const suit = SUIT[gm.suit] ?? SUIT[0]
  const shirt = SHIRT[gm.shirt] ?? SHIRT[0]
  const tie = TIE[gm.tie] ?? TIE[0]
  const style = HAIR_STYLES[gm.hair] ?? 'short'
  const facial = FACIAL[gm.facial] ?? 'none'
  const glasses = GLASSES[gm.glasses] ?? 'none'
  const skinDark = shade(skin, -26)

  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title || 'General manager portrait'}
    >
      <defs>
        <clipPath id="gmClip"><rect x="0" y="0" width="128" height="128" rx="3" /></clipPath>
      </defs>
      <g clipPath="url(#gmClip)">
        <rect width="128" height="128" fill="#e6e4df" />
        <circle cx="64" cy="58" r="46" fill="#dedbd4" />

        {/* shoulders + jacket */}
        <path d="M18 128c0-24 14-38 33-43h26c19 5 33 19 33 43z" fill={suit} />
        {/* shirt V */}
        <path d="M52 85h24l-12 26z" fill={shirt} />
        {/* lapels */}
        <path d="M51 85 64 111 55 128H41z" fill={shade(suit, 14)} />
        <path d="M77 85 64 111l9 17h14z" fill={shade(suit, 14)} />
        {/* tie */}
        <path d="M64 93l6 6-4 20-2 6-2-6-4-20z" fill={tie} />
        <path d="M60 88h8l2 5-6 5-6-5z" fill={shade(tie, -22)} />

        {/* neck */}
        <path d="M56 68h16v18c0 4-16 4-16 0z" fill={skinDark} />
        {/* head */}
        <ellipse cx="64" cy="49" rx="23" ry="26" fill={skin} />
        {/* ears */}
        <ellipse cx="41" cy="51" rx="4" ry="6" fill={skin} />
        <ellipse cx="87" cy="51" rx="4" ry="6" fill={skin} />

        {/* facial hair under the mouth line */}
        {facial === 'beard' && (
          <path d="M41 48c0 20 10 30 23 30s23-10 23-30c0 0-3 16-23 16S41 48 41 48z"
                fill={hairC} opacity="0.92" />
        )}
        {facial === 'stubble' && (
          <path d="M42 50c1 18 11 28 22 28s21-10 22-28c0 0-4 14-22 14S42 50 42 50z"
                fill={hairC} opacity="0.28" />
        )}
        {(facial === 'goatee') && (
          <path d="M56 62h16c0 10-4 15-8 15s-8-5-8-15z" fill={hairC} opacity="0.9" />
        )}
        {(facial === 'mustache' || facial === 'goatee' || facial === 'beard') && (
          <path d="M55 58h18c0 4-4 6-9 6s-9-2-9-6z" fill={hairC} opacity="0.95" />
        )}

        {/* brows */}
        <rect x="50" y="41" width="11" height="3" rx="1.5" fill={hairC} opacity=".85" />
        <rect x="67" y="41" width="11" height="3" rx="1.5" fill={hairC} opacity=".85" />
        {/* eyes */}
        <circle cx="55.5" cy="49" r="2.6" fill="#2A2118" />
        <circle cx="72.5" cy="49" r="2.6" fill="#2A2118" />
        {/* nose + mouth */}
        <path d="M64 51v6h3" fill="none" stroke={skinDark} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M58 64q6 4 12 0" fill="none" stroke={shade(skin, -60)} strokeWidth="1.8" strokeLinecap="round" />

        {/* hair */}
        {style === 'short' && (
          <path d="M41 46c0-16 10-25 23-25s23 9 23 25c0-8-8-12-23-12s-23 4-23 12z" fill={hairC} />
        )}
        {style === 'fade' && (
          <>
            <path d="M42 44c1-15 10-23 22-23s21 8 22 23c0-7-9-10-22-10s-21 3-22 10z" fill={hairC} />
            <rect x="41" y="42" width="46" height="5" fill={hairC} opacity=".35" />
          </>
        )}
        {style === 'waves' && (
          <>
            <path d="M41 45c0-16 10-24 23-24s23 8 23 24c0-8-8-11-23-11s-23 3-23 11z" fill={hairC} />
            <path d="M45 34q9-5 19 0t19 0" fill="none" stroke={shade(hairC, 34)} strokeWidth="1.6" opacity=".6" />
          </>
        )}
        {style === 'curls' && (
          <g fill={hairC}>
            <path d="M41 47c0-17 10-26 23-26s23 9 23 26c0-9-8-13-23-13s-23 4-23 13z" />
            {[[45, 27], [54, 22], [64, 20], [74, 22], [83, 27], [40, 37], [88, 37]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="6.5" />
            ))}
          </g>
        )}
        {style === 'long' && (
          <>
            <path d="M38 46c0-18 11-27 26-27s26 9 26 27v30c-4 2-7-2-7-10V46c0-9-8-13-19-13s-19 4-19 13v30c0 8-3 12-7 10z" fill={hairC} />
          </>
        )}
        {style === 'bald' && (
          <path d="M41 52c0-4 1-8 2-11 1 6 9 8 21 8s20-2 21-8c1 3 2 7 2 11 0-14-9-22-23-22s-23 8-23 22z"
                fill={hairC} opacity=".55" />
        )}

        {/* glasses */}
        {glasses === 'rect' && (
          <g fill="none" stroke="#2A2E33" strokeWidth="2">
            <rect x="46" y="43" width="19" height="13" rx="2" />
            <rect x="63" y="43" width="19" height="13" rx="2" />
            <path d="M65 49h-2M46 47l-5 1M82 47l5 1" />
          </g>
        )}
        {glasses === 'round' && (
          <g fill="none" stroke="#2A2E33" strokeWidth="2">
            <circle cx="55.5" cy="49" r="8.5" />
            <circle cx="72.5" cy="49" r="8.5" />
            <path d="M64 49h0M47 47l-6 1M81 47l6 1" />
          </g>
        )}

        {/* lanyard */}
        <path d="M52 86 44 128M76 86l8 42" stroke={shade(suit, 40)} strokeWidth="2.2" fill="none" opacity=".55" />
      </g>
    </svg>
  )
}
