"""Manim scene for a vertical (9:16) short. Reads the beat list from $SHORT_SPEC (json: {"theme":{...},"beats":[{"kind","dur",...}]}).

Templates: hook, versus, payoff, meter, dots, bignum, flow, compare, list, cta. A beat animates for part of its length, then drifts
slowly (a gentle zoom) until the narration ends. Every Text is fitted to the safe width, so nothing leaves the frame. The theme
(palette + animated background style) is chosen per paper by make_short.py, so two papers do not look alike.
Layout: top 1.6 units kept clear for the Shorts UI, bottom 4.3 units (caption + Shorts UI) kept clear; content lives between y=+5.4 and y=-3.3.
"""
import json, math, os, re, sys
from manim import *

config.frame_width, config.frame_height = 9, 16
try:   # the renderer reads the background at import time, so take it from the spec here
    config.background_color = json.load(open(os.environ["SHORT_SPEC"], encoding="utf8")).get("theme", {}).get("bg", "#0F1530")
except Exception:
    config.background_color = "#0F1530"

SAFE_W = 7.6          # widest any single piece of text or diagram may be (frame is 9 wide)
TOP_Y, BOT_Y = 5.4, -3.3
C1, C2, C3, INK, SOFT = "#2EC4B6", "#FFB703", "#FF5A5F", "#F4F6FB", "#7C86AD"
LEGACY = {"#2EC4B6": "c1", "#FFB703": "c2", "#FF5A5F": "c3"}
FONT = os.environ.get("SHORT_FONT", "DejaVu Sans")   # container fonts: DejaVu; a laptop sets SHORT_FONT="Segoe UI"


def col(x):
    """Director colours may be 'c1'/'c2'/'c3' or the legacy hex values; both map onto the theme."""
    x = LEGACY.get(x, x)
    if x in ("c1", "c2", "c3"):
        return {"c1": C1, "c2": C2, "c3": C3}[x]
    if isinstance(x, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", x):
        return x
    return C1      # YT-COLOR-1: a director value that is no colour ("hundreds", agent_issues: row 3, "Color hundreds not found") must not kill the render


def fit(m, w=SAFE_W, h=None):
    if m.width > w:
        m.scale(w / m.width)
    if h and m.height > h:
        m.scale(h / m.height)
    return m


# --- layout helper (pure python: container/test_layout.py runs it without manim) ---
def centre_dy(top, bottom, band_top=5.4, band_bottom=-3.3, max_move=2.0, min_move=0.05):
    """YT-10: how far (frame units, up is positive) a beat whose content spans [bottom, top] moves to sit in the middle of the content band.
    The 2026-10-28 renders clustered content in the upper half; the tag sits above the band and the captions below it, so the middle of the band is the optical centre.
    Never pushes the content out of the band, never moves a group taller than the band, and ignores a move under min_move (no wobble for nothing)."""
    try:
        top, bottom = float(top), float(bottom)
    except (TypeError, ValueError):
        return 0.0
    h = top - bottom
    if not (h > 0) or h > (band_top - band_bottom):
        return 0.0
    want = (band_top + band_bottom) / 2 - (top + bottom) / 2
    want = max(band_bottom - bottom, min(band_top - top, want))
    want = max(-max_move, min(max_move, want))
    return 0.0 if abs(want) < min_move else want
# --- end layout helper ---


def T(s, size=40, color=None, bold=True, maxw=SAFE_W, **k):
    t = Text(s, font=FONT, font_size=size, color=color or INK, weight=BOLD if bold else NORMAL, **k)
    return fit(t, maxw)


class ShortScene(Scene):
    def construct(self):
        global C1, C2, C3, INK, SOFT
        spec = json.load(open(os.environ["SHORT_SPEC"], encoding="utf8"))
        th = spec.get("theme", {})
        C1, C2, C3 = th.get("c1", C1), th.get("c2", C2), th.get("c3", C3)
        INK, SOFT = th.get("ink", INK), th.get("soft", SOFT)
        self.add_background(th.get("style", "bubbles"))
        tag = T(spec.get("tag", "QNFO IN PLAIN LANGUAGE"), 22, C1).move_to([0, 6.3, 0])
        ai = T("AI-GENERATED NARRATION", 16, SOFT, bold=False).next_to(tag, DOWN, buff=0.12)
        self.add(tag, ai)
        exits = ["fade", "left", "up", "shrink", "right"]
        for i, b in enumerate(spec["beats"]):
            t0 = self.time
            grp = getattr(self, "beat_" + b["kind"])(b)
            fit(grp, SAFE_W + 0.4)
            try:      # YT-10: centre the beat between the tag and the captions; any failure leaves the beat where the template put it
                dy = centre_dy(grp.get_top()[1], grp.get_bottom()[1]) if len(grp.submobjects) else 0.0
                if dy:
                    self.play(grp.animate.shift(UP * dy), run_time=0.25)
            except Exception as e:
                print("centre_dy skipped: %r" % (e,), file=sys.stderr)
            used = self.time - t0
            hold = max(0.0, b["dur"] - used - 0.35)
            if hold > 0.05:
                self.play(grp.animate.scale(1.035), run_time=hold, rate_func=linear)   # slow push-in instead of a dead hold
            ex = b.get("exit") or exits[(i + sum(map(ord, b["kind"])) % 3) % len(exits)]
            anim = {"fade": FadeOut(grp), "left": FadeOut(grp, shift=LEFT * 3), "right": FadeOut(grp, shift=RIGHT * 3),
                    "up": FadeOut(grp, shift=UP * 3), "shrink": FadeOut(grp, scale=0.4)}[ex]
            self.play(anim, run_time=0.35)

    # ---------------------------------------------------------------- backgrounds (all slow, all updater-driven)
    def add_background(self, style):
        getattr(self, "bg_" + style, self.bg_bubbles)()

    def bg_bubbles(self):
        circles = VGroup(*[Circle(radius=r, fill_color=c, fill_opacity=0.10, stroke_width=0).move_to([x, y, 0])
                           for r, c, x, y in [(2.6, C1, -3, 4), (3.2, C2, 3.5, -2), (2.0, C3, -2, -5), (2.4, C1, 3, 6)]])
        base = [m.get_center().copy() for m in circles]

        def drift(g):
            t = self.time
            for i, m in enumerate(g):
                m.move_to(base[i] + np.array([0.5 * math.sin(t * 0.4 + i), 0.5 * math.cos(t * 0.3 + i * 2), 0]))
        circles.add_updater(drift); self.add(circles)

    def bg_grid(self):
        sp = 1.0
        lines = VGroup(*[Line([-5, y * sp, 0], [5, y * sp, 0], stroke_width=2, color=C1, stroke_opacity=0.14) for y in range(-10, 11)],
                       *[Line([x * sp, -9, 0], [x * sp, 9, 0], stroke_width=2, color=C1, stroke_opacity=0.10) for x in range(-5, 6)])

        def scroll(g):
            g.shift(UP * 0.0)  # keep object, move by absolute time
            g.move_to([0, (self.time * 0.35) % sp, 0])
        lines.add_updater(scroll); self.add(lines)
        glow = Circle(radius=4.5, fill_color=C2, fill_opacity=0.08, stroke_width=0).move_to([0, -2, 0])
        self.add(glow)

    def bg_rings(self):
        rings = VGroup(*[Circle(radius=1, stroke_width=3, color=C1 if i % 2 else C2, fill_opacity=0) for i in range(5)])

        def pulse(g):
            for i, r in enumerate(g):
                f = ((self.time * 0.18) + i / 5) % 1
                r.become(Circle(radius=0.5 + f * 8, stroke_width=3, color=C1 if i % 2 else C2, stroke_opacity=0.28 * (1 - f)).move_to([0, 0.5, 0]))
        rings.add_updater(pulse); self.add(rings)

    def bg_waves(self):
        waves = VGroup(*[VMobject() for _ in range(4)])

        def wave(g):
            for i, w in enumerate(g):
                y0 = -6 + i * 1.7
                pts = [[x, y0 + 0.45 * math.sin(x * 0.9 + self.time * (0.6 + 0.15 * i) + i), 0] for x in np.linspace(-5, 5, 40)]
                w.set_points_smoothly(pts); w.set_stroke(C1 if i % 2 == 0 else C2, 3, opacity=0.22)
        waves.add_updater(wave); self.add(waves)

    def bg_stars(self):
        rng = np.random.default_rng(7)
        seeds = [(rng.uniform(-4.3, 4.3), rng.uniform(0, 17), rng.uniform(0.15, 0.6), rng.uniform(0.03, 0.09)) for _ in range(42)]
        dots = VGroup(*[Dot(radius=s[3], color=C1 if i % 3 else C2, fill_opacity=0.5) for i, s in enumerate(seeds)])

        def rise(g):
            for d, (x, y0, v, _) in zip(g, seeds):
                d.move_to([x + 0.15 * math.sin(self.time + y0), -8.5 + (y0 + self.time * v) % 17, 0])
        dots.add_updater(rise); self.add(dots)

    # ---------------------------------------------------------------- templates
    def beat_hook(self, b):
        g = VGroup(*[T(w, b.get("size", 76), C2 if i in b.get("hi", []) else INK) for i, w in enumerate(b["lines"])]).arrange(DOWN, buff=0.3).move_to(UP * 1.3)
        self.play(LaggedStart(*[FadeIn(m, shift=UP * 0.4, scale=0.7) for m in g], lag_ratio=0.3), run_time=min(1.8, b["dur"] * 0.5))
        self.play(Indicate(g[b.get("hi", [0])[0]], color=C2, scale_factor=1.1), run_time=0.7)
        return g

    def beat_cta(self, b):
        a = T(b["title"], 56).move_to(UP * 3.2)
        u = T(b["url"], 46, C1, maxw=6.6)
        box = RoundedRectangle(corner_radius=0.3, width=max(7.0, u.width + 0.8), height=1.5, color=C1, fill_color=C1, fill_opacity=0.18, stroke_width=4).move_to(UP * 1.2)
        u.move_to(box)
        sub = T(b["sub"], 34, SOFT, bold=False).next_to(box, DOWN, buff=0.5)
        g = VGroup(a, box, u, sub)
        self.play(FadeIn(a, shift=UP * 0.3), run_time=0.5)
        self.play(Create(box), Write(u), run_time=0.9)
        self.play(FadeIn(sub), run_time=0.4)
        self.play(Indicate(u, color=C2), run_time=0.6)
        return g

    def beat_versus(self, b):
        def card(x, color, label, icon):
            r = RoundedRectangle(corner_radius=0.3, width=3.6, height=5.0, color=color, fill_color=color, fill_opacity=0.14, stroke_width=4).move_to([x, 1.8, 0])
            lab = T(label, 32, color, maxw=3.2).next_to(r.get_bottom(), UP, buff=0.5)
            icon.move_to(r.get_center() + UP * 0.5)
            return VGroup(r, icon, lab)
        target = VGroup(*[Circle(radius=rr, color=C1, stroke_width=7) for rr in (1.2, 0.8, 0.4)], Dot(radius=0.12, color=C2))
        story = VGroup(*[Line(LEFT * 1.0, RIGHT * (1.0 - 0.3 * (i % 2)), color=C2, stroke_width=9) for i in range(5)]).arrange(DOWN, buff=0.28, aligned_edge=LEFT)
        story.add(Star(n=5, outer_radius=0.35, color=C2, fill_opacity=1).next_to(story, UP, buff=0.3))
        left, right = card(-2.05, C1, b["left"], target), card(2.05, C2, b["right"], story)
        self.play(FadeIn(left, shift=RIGHT * 0.8), run_time=0.6)
        self.play(FadeIn(right, shift=LEFT * 0.8), run_time=0.6)
        self.play(LaggedStart(*[Indicate(m, color=C2, scale_factor=1.15) for m in target[:3]], lag_ratio=0.2), run_time=1.0)
        return VGroup(left, right)

    def beat_payoff(self, b):
        base_y = 1.8
        line = Line(LEFT * 3.6, RIGHT * 3.6, color=SOFT).move_to([0, base_y, 0])
        self.play(Create(line), run_time=0.3)
        out = VGroup(line)
        for x, v, color, label in b["bars"]:
            color = col(color)
            h = abs(v) * 1.5
            bar = Rectangle(width=1.5, height=h, color=color, fill_color=color, fill_opacity=0.85, stroke_width=0)
            bar.move_to([x, base_y + (h / 2 if v > 0 else -h / 2), 0])
            grow = bar.copy().stretch_to_fit_height(0.01).move_to([x, base_y, 0])
            val = T(("+" if v > 0 else "−") + str(abs(v)), 44, color)
            val.next_to(bar, UP if v > 0 else DOWN, buff=0.18)
            lab = T(label, 26, INK, bold=False, maxw=2.3).move_to([x, base_y - 2.4, 0])
            self.play(Transform(grow, bar), FadeIn(val, shift=UP * 0.2), FadeIn(lab), run_time=0.7)
            out.add(grow, val, lab)
        return out

    def beat_meter(self, b):
        x0, x1, y = -3.3, 3.3, 2.6
        axis = Line([x0, y, 0], [x1, y, 0], color=SOFT, stroke_width=10)
        xs = lambda f: x0 + (x1 - x0) * f
        thr = Line([xs(b["need"]), y - 0.7, 0], [xs(b["need"]), y + 0.7, 0], color=C2, stroke_width=8)
        thr_lab = T(b["need_label"], 28, C2, maxw=5.5).next_to(thr, UP, buff=0.25)
        fill = Line([x0, y, 0], [x0, y, 0], color=C1, stroke_width=18)
        dot = Dot([x0, y, 0], radius=0.26, color=C1)
        have = T(b["have_label"], 30, C3, maxw=5.5)
        cap = T(b["axis_label"], 26, SOFT, bold=False, maxw=6.6).move_to([0, y - 3.1, 0])
        self.play(Create(axis), FadeIn(cap), run_time=0.4)
        self.play(Create(thr), FadeIn(thr_lab, shift=DOWN * 0.2), run_time=0.5)
        end = [xs(b["have"]), y, 0]
        self.play(dot.animate.move_to(end), fill.animate.put_start_and_end_on([x0, y, 0], end), run_time=1.6, rate_func=smooth)
        have.next_to(dot, DOWN, buff=0.5)
        have.shift(LEFT * max(0, have.get_right()[0] - 4.0))
        self.play(dot.animate.set_color(C3), fill.animate.set_color(C3), FadeIn(have), run_time=0.5)
        gap = T(b["verdict"], 40, C3).move_to([0, y - 2.2, 0])
        self.play(FadeIn(gap, scale=0.8), Wiggle(dot), run_time=0.7)
        return VGroup(axis, thr, thr_lab, fill, dot, have, cap, gap)

    def beat_dots(self, b):
        n, cols = 20, 5
        pts = [[(i % cols - 2) * 1.05, 3.4 - (i // cols) * 1.05, 0] for i in range(n)]
        k0, k1 = round(b["from"] * n), round(b["to"] * n)
        dots = VGroup(*[Dot(p, radius=0.38, color=C1 if i < k0 else C2) for i, p in enumerate(pts)])
        leg = VGroup(VGroup(Dot(color=C1, radius=0.16), T(b["a"], 26, C1, maxw=2.8)).arrange(RIGHT, buff=0.2),
                     VGroup(Dot(color=C2, radius=0.16), T(b["b"], 26, C2, maxw=2.8)).arrange(RIGHT, buff=0.2)).arrange(RIGHT, buff=0.6).move_to([0, 4.9, 0])
        cnt = T(f"{k0} of {n}", 54, C1).move_to([0, -1.0, 0])
        self.play(LaggedStart(*[GrowFromCenter(d) for d in dots], lag_ratio=0.03), FadeIn(leg), FadeIn(cnt), run_time=1.0)
        order = range(k0, k1) if k1 > k0 else range(k0 - 1, k1 - 1, -1)
        anims = [dots[i].animate.set_color(C1 if k1 > k0 else C2).scale(1.25) for i in order]
        new = T(f"{k1} of {n}", 54, C1).move_to(cnt)
        self.play(LaggedStart(*anims, lag_ratio=0.25), Transform(cnt, new), run_time=max(1.2, min(3.2, 0.25 * len(anims) + 1)))
        self.play(*[dots[i].animate.scale(0.8) for i in order], run_time=0.3)
        return VGroup(dots, leg, cnt)

    # --- bignum: a ring fills while the number counts up. params: value, suffix, label, frac (ring fill 0-1), color
    def beat_bignum(self, b):
        color = col(b.get("color", "c2"))
        val, frac = float(b["value"]), float(b.get("frac", 1.0))
        trk = ValueTracker(0)
        ring_bg = Circle(radius=2.1, stroke_width=22, color=SOFT, stroke_opacity=0.25).move_to([0, 2.3, 0])
        ring = always_redraw(lambda: Arc(radius=2.1, start_angle=PI / 2, angle=-TAU * frac * trk.get_value(), stroke_width=22, color=color).move_to(ring_bg))
        dec = int(b.get("decimals", 0))
        num = always_redraw(lambda: T(f"{b.get('prefix', '')}{trk.get_value() * val:,.{dec}f}{b.get('suffix', '')}", 84, color, maxw=3.6).move_to(ring_bg))
        label = T(b["label"], 36, INK, maxw=7.0).next_to(ring_bg, DOWN, buff=0.7)
        sub = T(b["sub"], 28, SOFT, bold=False, maxw=7.0).next_to(label, DOWN, buff=0.3) if b.get("sub") else VGroup()
        self.play(FadeIn(ring_bg), run_time=0.3)
        self.add(ring, num)
        self.play(trk.animate.set_value(1), run_time=min(2.0, b["dur"] * 0.55), rate_func=smooth)
        self.play(FadeIn(label, shift=UP * 0.3), FadeIn(sub), run_time=0.5)
        ring.clear_updaters(); num.clear_updaters()
        return VGroup(ring_bg, ring, num, label, sub)

    # --- flow: boxes joined by arrows, lit in sequence. params: nodes [labels], last_hot (bool)
    def beat_flow(self, b):
        nodes = b["nodes"]
        n = len(nodes)
        step = min(2.2, 6.4 / max(1, n - 1)) if n > 1 else 0
        boxes, arrows, out = [], [], VGroup()
        for i, s in enumerate(nodes):
            c = C2 if (i == n - 1 and b.get("last_hot", True)) else C1
            lab = T(s, 32, INK, maxw=5.4)
            r = RoundedRectangle(corner_radius=0.25, width=max(3.4, lab.width + 0.8), height=1.15, color=c, fill_color=c, fill_opacity=0.16, stroke_width=4)
            lab.move_to(r)
            bx = VGroup(r, lab).move_to([0, TOP_Y - 0.9 - i * step, 0])
            boxes.append(bx)
        for i in range(n - 1):
            arrows.append(Arrow(boxes[i].get_bottom(), boxes[i + 1].get_top(), buff=0.1, color=SOFT, stroke_width=7, max_tip_length_to_length_ratio=0.35))
        for i, bx in enumerate(boxes):
            self.play(FadeIn(bx, shift=UP * 0.3, scale=0.9), *( [GrowArrow(arrows[i - 1])] if i else [] ), run_time=0.55)
            out.add(bx, *( [arrows[i - 1]] if i else [] ))
        self.play(Indicate(boxes[-1], color=C2, scale_factor=1.08), run_time=0.6)
        return out

    # --- compare: horizontal bars growing to fractions. params: items [[label, frac, colour, text]], title
    def beat_compare(self, b):
        items = b["items"]
        out = VGroup()
        if b.get("title"):
            ttl = T(b["title"], 34, INK, maxw=7.0).move_to([0, 4.7, 0]); out.add(ttl)
            self.play(FadeIn(ttl, shift=DOWN * 0.2), run_time=0.4)
        track_w = 6.4
        for i, (label, frac, color, text) in enumerate(items):
            color = col(color)
            y = 3.4 - i * 1.7
            lab = T(label, 28, INK, bold=False, maxw=6.4).move_to([0, y + 0.55, 0]).align_to([-track_w / 2, 0, 0], LEFT)
            track = RoundedRectangle(corner_radius=0.22, width=track_w, height=0.55, color=SOFT, fill_color=SOFT, fill_opacity=0.18, stroke_width=0).move_to([0, y, 0])
            bar = RoundedRectangle(corner_radius=0.22, width=max(0.3, track_w * frac), height=0.55, color=color, fill_color=color, fill_opacity=0.95, stroke_width=0)
            bar.align_to(track, LEFT).set_y(y)
            grow = bar.copy().stretch_to_fit_width(0.01).align_to(track, LEFT)
            val = T(text, 34, color, maxw=2.4).next_to(track, DOWN, buff=0.12).align_to(track, RIGHT)
            self.play(FadeIn(lab), FadeIn(track), run_time=0.3)
            self.play(Transform(grow, bar), FadeIn(val), run_time=0.8)
            out.add(lab, track, grow, val)
        return out

    # --- list: numbered points that slide in. params: items [str], title
    def beat_list(self, b):
        out = VGroup()
        if b.get("title"):
            ttl = T(b["title"], 38, C2, maxw=7.0).move_to([0, 4.7, 0]); out.add(ttl)
            self.play(FadeIn(ttl, shift=DOWN * 0.2), run_time=0.4)
        for i, s in enumerate(b["items"]):
            y = 3.5 - i * 1.55
            badge = VGroup(Circle(radius=0.38, color=C1, fill_color=C1, fill_opacity=0.25, stroke_width=4), T(str(i + 1), 34, C1)).move_to([-3.1, y, 0])
            txt = T(s, 32, INK, bold=False, maxw=6.0).move_to([0, y, 0]).align_to([-2.5, 0, 0], LEFT)
            row = VGroup(badge, txt)
            self.play(FadeIn(row, shift=LEFT * 0.8), run_time=0.55)
            out.add(row)
        return out

    # --- compatibility with directors written before YT-POC-3 (qnfo-youtube-shorts 0.1.x emitted these kinds)
    def beat_points(self, b):
        return self.beat_list(dict(b, title=b.get("title", "")))

    def beat_stat(self, b):
        color = C2
        ring_bg = Circle(radius=2.1, stroke_width=22, color=color, stroke_opacity=0.9).move_to([0, 2.3, 0])
        big = T(str(b["value"]), 84, color, maxw=3.6).move_to(ring_bg)
        lab = T(b["label"], 36, INK, maxw=7.0).next_to(ring_bg, DOWN, buff=0.7)
        self.play(Create(ring_bg), GrowFromCenter(big), run_time=0.9)
        self.play(FadeIn(lab, shift=UP * 0.3), run_time=0.5)
        return VGroup(ring_bg, big, lab)
