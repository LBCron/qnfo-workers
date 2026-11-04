"""YT-VOICE-1 offline test: Kokoro token times become caption words (no model needed). Run: python container/test_voice.py"""
import sys
from pathlib import Path
from types import SimpleNamespace as T
sys.path.insert(0, str(Path(__file__).resolve().parent))
import render

toks = [T(text="Errors", start_ts=0.0, end_ts=0.4), T(text="pile", start_ts=0.4, end_ts=0.7), T(text="up", start_ts=None, end_ts=None),
        T(text=",", start_ts=None, end_ts=None), T(text="fast", start_ts=1.0, end_ts=1.5), T(text=".", start_ts=None, end_ts=None)]
w = render.words_from_tokens(toks, 10.0)
assert [x[0] for x in w] == ["Errors", "pile", "up,", "fast."], w
assert abs(w[0][1] - 10.0) < 1e-9 and abs(w[3][1] - 11.0) < 1e-9
assert abs(w[2][1] - 10.7) < 1e-9, "an untimed token starts where the previous word ended"
assert all(x[2] > 0 for x in w)
assert render.words_from_tokens(None, 0) == []
print("ok")

assert render.speakable("circle with Lego bricks — you get close.  Never round") == "circle with Lego bricks, you get close. Never round"
assert render.words_from_tokens([T(text="—", start_ts=None, end_ts=None), T(text="Hi", start_ts=0.0, end_ts=0.2)], 0.0)[0][0] == "Hi"
print("ok speakable")
