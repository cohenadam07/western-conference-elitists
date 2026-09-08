// The GM's appearance as plain data.
//
// Kept out of avatar.jsx on purpose: storage.js, the season tooling and anything running
// under bare Node need the defaults, and importing a .jsx file to get a default object
// means the save layer cannot load outside a bundler. Data here, rendering there.

export const SKIN = ['#F2D3B8', '#E8BC96', '#D2A077', '#B47C4F', '#8D5B34', '#5F3A20']
export const HAIR_COLOR = ['#1B1613', '#3D2A1E', '#6B4A2C', '#A8763F', '#C9C3BC', '#8C2F1B']
export const SUIT = ['#22395a', '#182b47', '#2F3437', '#4A4038', '#5A5F66', '#1F3A34']
export const SHIRT = ['#FFFFFF', '#DCE6F2', '#C9CFD6', '#2A2E33']
export const TIE = ['#c2a263', '#bc3a2c', '#22395a', '#3a6b54', '#6B3A5B', '#2A2E33']

export const HAIR_STYLES = ['short', 'fade', 'waves', 'curls', 'long', 'bald']
export const FACIAL = ['none', 'stubble', 'mustache', 'goatee', 'beard']
export const GLASSES = ['none', 'rect', 'round']

export const DEFAULT_GM = {
  name: '', skin: 2, hair: 0, hairColor: 0, facial: 0, glasses: 0, suit: 0, shirt: 0, tie: 0,
}

export function randomGM(rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n)
  return {
    ...DEFAULT_GM,
    skin: pick(SKIN.length), hair: pick(HAIR_STYLES.length), hairColor: pick(HAIR_COLOR.length),
    facial: pick(FACIAL.length), glasses: pick(GLASSES.length),
    suit: pick(SUIT.length), shirt: pick(SHIRT.length), tie: pick(TIE.length),
  }
}
