"""YT-10 offline test: centre_dy puts a beat in the middle of the content band without manim. Run: python container/test_layout.py
The helper sits between two marker comments in short_scene.py (which imports manim at the top); this test runs only that block."""
import re
from pathlib import Path

src = (Path(__file__).resolve().parent / "short_scene.py").read_text(encoding="utf8")
m = re.search(r"# --- layout helper.*?\n(.*?)# --- end layout helper ---", src, re.S)
assert m, "the layout helper block is missing from short_scene.py"
ns = {}
exec(m.group(1), ns)
centre_dy = ns["centre_dy"]

BAND_TOP, BAND_BOT = 5.4, -3.3
MID = (BAND_TOP + BAND_BOT) / 2          # 1.05


def after(top, bottom):
    dy = centre_dy(top, bottom)
    return top + dy, bottom + dy, dy


# content clustered in the upper half moves down to the middle of the band
t, b, dy = after(4.2, 1.6)
assert dy < 0 and abs((t + b) / 2 - MID) < 1e-9, (t, b, dy)
# one move is limited to 2 units, so a far-off group lands closer to the middle but not in it
t, b, dy = after(5.2, 2.6)
assert dy == -2.0 and (t + b) / 2 > MID, (t, b, dy)
# content sitting low moves up
t, b, dy = after(0.2, -1.8)
assert dy > 0 and abs((t + b) / 2 - MID) < 1e-9, (t, b, dy)
# already centred: no move, no wobble
assert centre_dy(2.35, -0.25) == 0.0
# a move under 0.05 is ignored
assert centre_dy(2.37, -0.27) == 0.0
# never pushed out of the band, whatever the target
t, b, dy = after(5.4, 4.0)
assert b >= BAND_BOT - 1e-9 and t <= BAND_TOP + 1e-9 and dy < 0, (t, b, dy)
t, b, dy = after(-2.0, -3.3)
assert b >= BAND_BOT - 1e-9 and t <= BAND_TOP + 1e-9 and dy > 0, (t, b, dy)
# a group already above the band is brought back inside it, by at most max_move
t, b, dy = after(6.0, 5.0)
assert dy < 0 and abs(dy) <= 2.0 + 1e-9, (t, b, dy)
# a group taller than the band, an empty or a degenerate group, and junk input are left alone
assert centre_dy(5.4, -4.0) == 0.0
assert centre_dy(1.0, 1.0) == 0.0
assert centre_dy(0.0, 1.0) == 0.0
assert centre_dy(None, 1.0) == 0.0
assert centre_dy("a", "b") == 0.0
assert centre_dy(float("nan"), 1.0) == 0.0
# the limit on one move
assert abs(centre_dy(5.4, 5.2, max_move=0.5)) == 0.5
print("ok")
