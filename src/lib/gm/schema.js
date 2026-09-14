// THE SAVE FORMAT VERSION, IN ONE PLACE.
//
// This lived in two places that had no way of noticing each other: storage.js wrote
// `schema: 2` and api/gm.js rejected anything that was not `schema: 1`. So every career
// posted to the server came back 400 "unrecognised save version", pushCareer swallowed
// the error, and the all-time boards would have stayed empty forever with nothing on
// either side saying why.
//
// Same shape as every other bug that has cost this project a day: one value, two
// copies, nothing holding them in step. Both sides import this now.
export const SAVE_VERSION = 2

// Versions the server will still accept and verify. Add an old number here when the
// save shape changes in a way the server can still read, rather than widening the
// check at the call site.
export const ACCEPTED_VERSIONS = [2]
