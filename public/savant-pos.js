/* Why a player has his label, in a line of plain words. One implementation for the card and the
   AI connector (api/_basketball-lists.js imports it), so the two cannot disagree. The rule itself
   is pipeline/basketball/position_labels.py; this only says it.

   Usage: SavantPos.why(pe, pos) -> 'Plays the 4 first and the 5 second, so he is compared with bigs.'
          pe is the five shares PG, SG, SF, PF, C; pos is Guard, Wing or Big. */
(function (root) {
  'use strict';

  var PEERS = { Guard: 'guards', Wing: 'wings', Big: 'bigs' };
  var SECOND = 10;

  function why(pe, pos) {
    if (!pe || !pe.some(Boolean) || !PEERS[pos]) return null;
    var q = pe;       // as published: rounded shares can sum to 101, and 10 must stay 10
    var first = q.indexOf(Math.max.apply(null, q));
    var peers = PEERS[pos];
    if (first === 3) {
      var center = q[4], wing = q[1] + q[2];
      if (pos === 'Big' && center >= SECOND && center >= wing) return 'Plays the 4 first and the 5 second, so he is compared with bigs.';
      if (pos === 'Wing' && wing >= SECOND && wing > center) return 'Plays the 4 first and the ' + (q[2] >= q[1] ? 3 : 2) + ' second, so he is compared with wings.';
      return pos === 'Big'
        ? 'Plays almost only the 4, and rebounds, protects the rim and finishes inside like a big, so he is compared with bigs.'
        : 'Plays almost only the 4, and creates and shoots like a wing, so he is compared with wings.';
    }
    var second = -1;
    q.forEach(function (v, i) { if (i !== first && v >= SECOND && (second < 0 || v > q[second])) second = i; });
    return second < 0
      ? 'Plays almost only the ' + (first + 1) + ', so he is compared with ' + peers + '.'
      : 'Plays the ' + (first + 1) + ' first and the ' + (second + 1) + ' second, so he is compared with ' + peers + '.';
  }

  var api = { why: why };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SavantPos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
