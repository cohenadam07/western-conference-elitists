"""
assemble.py — College Basketball Coaching Savant's page from its sources.

    python3 tools/savant-cbcoaching/assemble.py                 -> public/college-basketball-coaching-savant.html
    python3 tools/savant-cbcoaching/assemble.py --out <file>    -> anywhere else (the check writes to a temp file)

The page is the files in ORDER (page-src/, and tools/themes/ for a 'theme:' entry) concatenated, byte for byte, nothing added. The sources are Basketball Coaching Savant's page-src, copied
with small in-place edits for the college clock and links, then 07-college.js, whose function declarations replace
the NBA ones that differ (in one script the last declaration of a name wins), then the tail.
Edit page-src/, then run this. Never edit public/college-basketball-coaching-savant.html directly: `npm run check:page-src` fails
when the published page and this assembler's output differ by a single byte (page-src/README.md).
"""
import argparse
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# 'theme:<path>' reads tools/themes/<path>: the college theme (tokens, fonts), the frame, sidebar and base rules College
# Basketball Savant's page reads too, and the skin that paints this page's components in the theme (tools/themes/README.md).
ORDER = ['01a-head.html', 'theme:college/fonts.html', '01b-style.html', 'theme:college/tokens.css', 'theme:shared/base.css', 'theme:shared/frame.css',
         'theme:shared/frame-narrow.css', '01c-coaching.css', 'theme:shared/coaching-skin.css', '01d-body.html',
         '02-core.js', '03-coach.js', '03b-career.js', '04-season.js', '05-sections.js', '06-tree.js', '07-college.js', 'theme:shared/sidebar.js', '09-tail.html']
THEMES = os.path.join(HERE, "..", "themes")
PAGE = os.path.join(HERE, "..", "..", "public", "college-basketball-coaching-savant.html")


def assemble():
    out = []
    for f in ORDER:
        p = os.path.join(THEMES, f[6:]) if f.startswith("theme:") else os.path.join(HERE, "page-src", f)
        with open(p, encoding="utf-8", newline="") as fh:
            out.append(fh.read())
    return "".join(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=PAGE)
    a = ap.parse_args()
    html = assemble()
    with open(a.out, "w", encoding="utf-8", newline="") as fh:
        fh.write(html)
    print("wrote", os.path.relpath(a.out), len(html.encode()), "bytes")
