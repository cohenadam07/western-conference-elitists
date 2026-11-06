"""
assemble.py — College Basketball Coaching Savant's page from its sources.

    python3 tools/savant-cbcoaching/assemble.py      -> public/college-basketball-coaching-savant.html

The sources are Basketball Coaching Savant's page (tools/savant-bcoaching/page-src), copied with small
in-place edits for the college clock and links, then 07-college.js, whose function declarations
replace the NBA ones that differ (in one script the last declaration of a name wins), then the tail.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ["01-head.html", "02-core.js", "03-coach.js", "03b-career.js", "04-season.js", "05-sections.js", "06-tree.js", "07-college.js", "09-tail.html"]
OUT = os.path.join(HERE, "..", "..", "public", "college-basketball-coaching-savant.html")

if __name__ == "__main__":
    with open(OUT, "w") as fh:
        for f in ORDER:
            fh.write(open(os.path.join(HERE, "page-src", f)).read())
    print("wrote", os.path.relpath(OUT), os.path.getsize(OUT), "bytes")
