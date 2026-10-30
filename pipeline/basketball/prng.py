"""
prng.py — the one random number generator the simulation is allowed to use.

Python's `random` is a Mersenne Twister and JavaScript's `Math.random` is unseedable and
implementation-defined, so a season simulated in the browser could never be verified by
the server. Section 12 flagged that as the single thing that would silently break every
leaderboard check. This is the fix: mulberry32, thirty lines, identical arithmetic in
both runtimes.

Two rules keep it identical:
  * every operation is 32-bit integer arithmetic, masked explicitly
  * every float that escapes is ROUNDED to 9 decimals. Transcendental functions (log,
    cos, sqrt) can disagree between runtimes in the last bit or two, and one bit is
    enough to flip a comparison and diverge a whole season. Nine decimals is far below
    anything the model cares about and far above where the runtimes disagree.
"""
import math

MASK = 0xFFFFFFFF
Q = 9   # decimals kept — the cross-runtime safety margin


def _imul(a, b):
    return ((a & MASK) * (b & MASK)) & MASK


class Rng:
    __slots__ = ("a",)

    def __init__(self, seed):
        self.a = int(seed) & MASK

    def rand(self):
        """mulberry32. Mirrors, operation for operation:
             a |= 0; a = a + 0x6D2B79F5 | 0;
             t = Math.imul(a ^ a >>> 15, 1 | a);
             t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
             return ((t ^ t >>> 14) >>> 0) / 4294967296;
        """
        self.a = (self.a + 0x6D2B79F5) & MASK
        a = self.a
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & MASK) ^ t
        return ((t ^ (t >> 14)) & MASK) / 4294967296.0

    def gauss(self, mu=0.0, sd=1.0):
        u1 = max(1e-12, self.rand())
        u2 = self.rand()
        z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return round(mu + sd * z, Q)

    def randrange(self, n):
        return int(self.rand() * n) % n

    def choice(self, seq):
        return seq[self.randrange(len(seq))]

    def shuffle(self, seq):
        for i in range(len(seq) - 1, 0, -1):
            j = self.randrange(i + 1)
            seq[i], seq[j] = seq[j], seq[i]
