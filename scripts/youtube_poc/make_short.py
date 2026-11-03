#!/usr/bin/env python3
"""YT-POC-2: director spec -> vertical 1080x1920 short with animated diagrams (Manim) + word-timed karaoke captions.

  python -I make_short.py --article <slug> [--out DIR] [--voice en-US-AndrewNeural]
  python -I make_short.py directors/<name>.json [--out DIR] [--voice en-US-AndrewNeural]
Stages: edge-tts per beat with WordBoundary -> beat durations -> Manim render (short_scene.py) -> ASS karaoke ->
ffmpeg mux -> metadata.json (Shorts). Deps: pip install manim edge-tts imageio-ffmpeg
"""
import argparse, asyncio, json, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_video import fetch_article, ffbin, duration, BASE  # noqa: E402


def speakable(t):
    """Text as a narrator would say it: no dashes or symbols that the engine reads flat or skips."""
    t = t.replace("—", ", ").replace("–", " to ").replace(" - ", ", ").replace("&", " and ").replace("%", " percent")
    t = re.sub(r"\s+([,.;:?!])", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()


async def tts_words(text, voice, mp3, rate="+4%"):
    """edge-tts sometimes returns NoAudioReceived (transient, or a rate/text it dislikes): retry, then drop the rate, then split at the sentence."""
    import edge_tts
    last = None
    plan = [(voice, rate)] * 4 + [(voice, "+0%"), ("en-US-AndrewNeural", "+0%")]   # the service drops requests at random: back off, then relax the rate, then fall back to the plain voice
    for attempt, (v, r) in enumerate(plan):
        try:
            return await _tts_once(speakable(text), v, mp3, r)
        except edge_tts.exceptions.NoAudioReceived as e:
            last = e
            await asyncio.sleep(min(30, 3 * 2 ** attempt))
    raise last


async def _tts_once(text, voice, mp3, rate):
    import edge_tts
    words, com = [], edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    with open(mp3, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["text"], ch["offset"] / 1e7, ch["duration"] / 1e7))
    return words


THEMES = {   # palette + animated background; chosen per paper from the slug so videos do not share one look
    "midnight": dict(bg="#0F1530", c1="#2EC4B6", c2="#FFB703", c3="#FF5A5F", style="bubbles"),
    "ember":    dict(bg="#1A0E12", c1="#FF8A5B", c2="#FFD166", c3="#06D6A0", style="grid"),
    "forest":   dict(bg="#0A1E19", c1="#7AE582", c2="#F9DC5C", c3="#FF6B6B", style="rings"),
    "ocean":    dict(bg="#06182A", c1="#4CC9F0", c2="#FFD60A", c3="#F72585", style="waves"),
    "violet":   dict(bg="#160E2D", c1="#B388FF", c2="#FFD54F", c3="#FF6E6E", style="stars"),
}


def pick_theme(spec):
    import zlib
    name = spec.get("theme_name") or list(THEMES)[zlib.crc32(spec["slug"].encode()) % len(THEMES)]
    return name, dict(THEMES[name], **(spec.get("theme") or {}))


def bgr(hexcol):
    h = hexcol.lstrip("#")
    return f"&H{h[4:6]}{h[2:4]}{h[0:2]}&"


def text_w(text, size, _f={}):
    """Pixel width of text in the caption font (Segoe UI Bold), so a chunk never exceeds the frame."""
    from PIL import ImageFont
    if size not in _f:
        for p in ("C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            if os.path.exists(p):
                _f[size] = ImageFont.truetype(p, size); break
        else:
            _f[size] = None
    f = _f[size]
    return f.getlength(text) if f else 0.62 * size * len(text)


CAP_SIZE, CAP_MAX_W = 84, 880      # frame is 1080 wide; margins 60 + outline leave ~930, keep 50 spare for the enlarged active word


def punctuate(words, narr):
    """edge-tts word events carry no punctuation; take each word's text (with its commas, full stops, case) from the narration so captions can break at phrases."""
    toks = speakable(narr).split()
    norm = lambda x: re.sub(r"[^a-z0-9]", "", x.lower())
    out, j = [], 0
    for w, s0, d in words:
        for k in range(j, min(len(toks), j + 4)):
            if norm(toks[k]) == norm(w):
                w, j = toks[k], k + 1
                break
        out.append((w, s0, d))
    return out


def ass_time(x):
    return f"{int(x//3600)}:{int(x%3600//60):02d}:{x%60:05.2f}"


def build_ass(words, path, accent="#FFB703", edge="#0F1530"):
    """Phrase chunks: at most 4 words, measured to fit the frame, broken at commas and sentence ends; the spoken word is accent-coloured and larger."""
    outline = "&H00" + bgr(edge)[2:].rstrip("&")
    hdr = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\n"
           "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
           f"Style: C,Segoe UI,{CAP_SIZE},&H00FFFFFF,&H00FFFFFF,{outline},&H00000000,1,0,0,0,100,100,0,0,1,7,2,2,60,60,520,1\n\n"
           "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
    chunks, cur = [], []
    for wd in words:
        trial = cur + [wd]
        if cur and (len(trial) > 4 or text_w(" ".join(x[0] for x in trial), CAP_SIZE) * 1.1 > CAP_MAX_W):
            chunks.append(cur); cur = []
        cur.append(wd)
        if wd[0][-1:] in ".?!,;:":
            chunks.append(cur); cur = []
    if cur: chunks.append(cur)
    hi = bgr(accent)
    ev = []
    for ci, chunk in enumerate(chunks):
        for i, (w, s0, d) in enumerate(chunk):
            end = chunk[i + 1][1] if i + 1 < len(chunk) else min(s0 + d + 0.2, chunks[ci + 1][0][1] if ci + 1 < len(chunks) else 1e9)
            txt = " ".join((r"{\c" + hi + r"\fscx112\fscy112}" + x + r"{\r}") if j == i else x for j, (x, _, _) in enumerate(chunk))
            ev.append(f"Dialogue: 0,{ass_time(s0)},{ass_time(end)},C,,0,0,0,,{txt}")
    Path(path).write_text(hdr + "\n".join(ev) + "\n", encoding="utf8")


def prepare_director(director, article_slug, output_root):
    if director and article_slug:
        raise ValueError("provide either a director JSON or --article, not both")
    if article_slug:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", article_slug):
            raise ValueError("article slug must contain lowercase letters, digits, and single hyphens")
        out = Path(output_root) / f"short-{article_slug}"
        out.mkdir(parents=True, exist_ok=True)
        path = out / "director.json"
        subprocess.run(
            [sys.executable, "-I", str(HERE / "make_director.py"), article_slug, "--out", str(path)],
            check=True,
        )
        return path, article_slug
    if not director:
        raise ValueError("provide a director JSON or --article <slug>")
    path = Path(director)
    return path, path.stem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("director", nargs="?"); ap.add_argument("--article", metavar="SLUG")
    ap.add_argument("--out", default=str(Path.home() / "yt-out"))
    ap.add_argument("--voice", default=None); ap.add_argument("--quality", default="h")
    a = ap.parse_args()
    try:
        director, name = prepare_director(a.director, a.article, a.out)
    except ValueError as e:
        ap.error(str(e))
    spec = json.loads(director.read_text("utf8"))
    out = Path(a.out) / ("short-" + name); out.mkdir(parents=True, exist_ok=True)
    ff = ffbin()
    art = fetch_article(spec["slug"])
    voice = a.voice or spec.get("voice") or "en-US-AndrewMultilingualNeural"
    tname, spec["theme"] = pick_theme(spec)

    t, allw, lst = 0.0, [], []
    for i, b in enumerate(spec["beats"]):
        mp3 = out / f"b{i}.mp3"
        w = asyncio.run(tts_words(b["narr"], voice, mp3, b.get("rate", "+4%")))
        d = duration(ff, mp3)
        last = max((s0 + dd for _, s0, dd in w), default=d)
        b["dur"] = round(min(d, last + 0.3) + 0.25, 2)    # tight: cut trailing silence, short breath between beats
        allw += [(x, s + t, dd) for x, s, dd in punctuate(w, b["narr"])]
        wav = out / f"b{i}.wav"   # pad each beat to its scene length so audio and picture stay locked
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(mp3), "-af", "apad", "-t", str(b["dur"]), "-ar", "24000", "-ac", "1", str(wav)], check=True)
        lst.append(f"file '{wav.as_posix()}'"); t += b["dur"]
    (out / "a.txt").write_text("\n".join(lst) + "\n"); total = t
    subprocess.run([ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / "a.txt"), str(out / "audio.wav")], check=True)
    build_ass(allw, out / "cap.ass", spec["theme"]["c2"], spec["theme"]["bg"])
    (out / "spec.json").write_text(json.dumps(spec), "utf8")
    print(f"{len(spec['beats'])} beats, {total:.1f}s, voice {voice}, theme {tname}; rendering Manim...")

    env = dict(os.environ, SHORT_SPEC=str(out / "spec.json"), PATH=os.path.dirname(ff) + os.pathsep + os.environ["PATH"])
    subprocess.run([sys.executable, "-m", "manim", "render", f"-q{a.quality}", "--fps", "30", "-r", "1080,1920", "--media_dir", str(out / "media"),
                    "-o", "diagram", str(HERE / "short_scene.py"), "ShortScene"], check=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    silent = next((out / "media").rglob("diagram.mp4"))
    final = out / "short.mp4"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(silent), "-i", str(out / "audio.wav"), "-vf", "subtitles=cap.ass", "-af", "highpass=f=80,acompressor=threshold=0.125:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=7", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
                    "-metadata", "comment=AI-generated: synthetic narration (text-to-speech) and generated animation from a QNFO plain-language paper summary", "-metadata", f"title={spec['title'][:80]}", "-metadata", f"artist=QNFO", str(final)],
                   check=True, cwd=out)

    title = spec["title"][:80]
    meta = {"title": f"{title} #Shorts"[:100],
            "description": f"{art['short']}\n\nFull plain-language article (no jargon, no mathematics): {art['url']}\nPaper: {BASE}/papers/{art['slug']}\n\n"
                           "AI disclosure: the voice is synthetic (text-to-speech) and the animations are generated from the plain-language version of a QNFO paper.\n#Shorts #science #research",
            "tags": ["Shorts", "science", "research explained", "QNFO"], "categoryId": "27", "privacyStatus": "private",
            "containsSyntheticMedia": True, "madeForKids": False, "duration_s": round(total, 1), "source": art["url"]}
    (out / "metadata.json").write_text(json.dumps(meta, indent=1), "utf8")
    import hashlib, datetime   # BP26-AI-ACT-ART50-1 / BP26-PROVENANCE-MARKING-1: machine-readable marking next to the file (the on-screen label is burned in)
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    (out / "provenance.json").write_text(json.dumps({
        "ai_generated": True, "disclosure": "synthetic narration and generated animation", "video_sha256": sha(final), "director_sha256": sha(out / "spec.json"),
        "source_url": art["url"], "voice": voice, "theme": tname, "writer": spec.get("writer", "human-or-director-file"),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}, indent=1), "utf8")
    print(f"OK {final} ({total:.0f}s, {final.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
