// Club colours. The whole interface takes them — that is the point of choosing a
// franchise rather than a difficulty setting. Values are tuned for legibility on a
// near-black ground, so a few differ from the official hex (Milwaukee's green and
// Charlotte's navy are both unreadable at 5% luminance).
export const CLUB = {
  ATL:['#E03A3E','#C1D32F'], BOS:['#00A94F','#BA9653'], BKN:['#D7DCE5','#6E7683'],
  CHA:['#00A2B8','#8B6FD8'], CHI:['#E0224A','#C9CED6'], CLE:['#FFB81C','#9B3350'],
  DAL:['#2F86D6','#B8C4CA'], DEN:['#FEC524','#3A6EA8'], DET:['#E23B4E','#3A66E0'],
  GSW:['#FFC72C','#2C63C4'], HOU:['#E0224A','#C4CED4'], IND:['#FDBB30','#2F6DB5'],
  LAC:['#E0224A','#3A66E0'], LAL:['#8A5CD8','#FDB927'], MEM:['#7C97CE','#B7C4DA'],
  MIA:['#F9A01B','#D6204E'], MIL:['#12A85C','#E8DCC2'], MIN:['#78BE20','#3D8FD6'],
  NOP:['#D6204E','#B4975A'], NYK:['#F58426','#2F86D6'], OKC:['#00A2E8','#EF3B24'],
  ORL:['#2F9BE0','#C4CED4'], PHI:['#2F86D6','#ED174C'], PHX:['#E56020','#9A7BE0'],
  POR:['#E03A3E','#D7DCE5'], SAC:['#9B6BD8','#8A939B'], SAS:['#C4CED4','#8A939B'],
  TOR:['#E0224A','#C9CED6'], UTA:['#F9A01B','#3A6EA8'], WAS:['#E31837','#3A66E0'],
}

export const CITY = {
  ATL:['Atlanta','Hawks'], BOS:['Boston','Celtics'], BKN:['Brooklyn','Nets'],
  CHA:['Charlotte','Hornets'], CHI:['Chicago','Bulls'], CLE:['Cleveland','Cavaliers'],
  DAL:['Dallas','Mavericks'], DEN:['Denver','Nuggets'], DET:['Detroit','Pistons'],
  GSW:['Golden State','Warriors'], HOU:['Houston','Rockets'], IND:['Indiana','Pacers'],
  LAC:['LA','Clippers'], LAL:['Los Angeles','Lakers'], MEM:['Memphis','Grizzlies'],
  MIA:['Miami','Heat'], MIL:['Milwaukee','Bucks'], MIN:['Minnesota','Timberwolves'],
  NOP:['New Orleans','Pelicans'], NYK:['New York','Knicks'], OKC:['Oklahoma City','Thunder'],
  ORL:['Orlando','Magic'], PHI:['Philadelphia','76ers'], PHX:['Phoenix','Suns'],
  POR:['Portland','Trail Blazers'], SAC:['Sacramento','Kings'], SAS:['San Antonio','Spurs'],
  TOR:['Toronto','Raptors'], UTA:['Utah','Jazz'], WAS:['Washington','Wizards'],
}

// Pale accents need dark text on top of them or the labels vanish.
const PALE = new Set(['#D7DCE5','#C4CED4','#FDBB30','#FEC524','#FFC72C','#F9A01B',
  '#78BE20','#C9CED6','#FFB81C','#B7C4DA','#E8DCC2'])

export function themeVars(team) {
  const [a, b] = CLUB[team] || ['#00A2E8', '#EF3B24']
  return { '--acc': a, '--acc-2': b, '--acc-ink': PALE.has(a.toUpperCase()) ? '#0A0C11' : '#FFFFFF' }
}

// Text on a club-coloured tile: dark on a pale club, white on the rest.
export const clubInk = (team) => (PALE.has((CLUB[team]?.[0] || '').toUpperCase()) ? '#0A0C11' : '#FFFFFF')

export const initials = (n) =>
  String(n || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
