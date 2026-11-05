"""YT-SERVER-1 render core, shared by server.py (Cloudflare Container) and the GitHub-runner fallback.

render(job, outdir) -> dict(path, duration_s). job = {"title", "beats": [{"kind", ..., "sentences": [{"text", "audio_b64"}]}]}.
Voice, YT-VOICE-1: a beat whose sentences carry no audio_b64 is spoken here by Kokoro-82M (Apache-2.0, CPU, no per-minute cost) in ONE pass over the
whole beat, so intonation runs across sentence ends, and the model's own token times give real word timing for the captions. A beat that carries audio
(the Workers AI Aura/melotts fallback) keeps the old path: each sentence's measured length is split over its words by character count.
"""
import base64, json, os, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CR, NL = chr(13), chr(10)
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
KOKORO_SPEED = float(os.environ.get("KOKORO_SPEED", "1.05"))     # a little brisker than the default 1.0, for short-form pace
KOKORO_RATE = 24000
PUNCT = ".,;:!?\"'()-—–…"
FONT = os.environ.get("SHORT_FONT", "DejaVu Sans")


def probe(path):
    if not shutil.which("ffprobe"):      # runner or dev machine with ffmpeg only: read "Duration: hh:mm:ss.xx" from ffmpeg -i
        err = subprocess.run(["ffmpeg", "-i", str(path)], capture_output=True, text=True).stderr
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def ass_time(x):
    return f"{int(x//3600)}:{int(x%3600//60):02d}:{x%60:05.2f}"


THEMES = {   # palette + animated background per paper (same table as scripts/youtube_poc/make_short.py)
    "midnight": dict(bg="#0F1530", c1="#2EC4B6", c2="#FFB703", c3="#FF5A5F", style="bubbles"),
    "ember":    dict(bg="#1A0E12", c1="#FF8A5B", c2="#FFD166", c3="#06D6A0", style="grid"),
    "forest":   dict(bg="#0A1E19", c1="#7AE582", c2="#F9DC5C", c3="#FF6B6B", style="rings"),
    "ocean":    dict(bg="#06182A", c1="#4CC9F0", c2="#FFD60A", c3="#F72585", style="waves"),
    "violet":   dict(bg="#160E2D", c1="#B388FF", c2="#FFD54F", c3="#FF6E6E", style="stars"),
}
CAP_SIZE, CAP_MAX_W = 84, 880      # frame is 1080 wide; keep 50 px spare for the enlarged active word and the outline
BOLD_FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/segoeuib.ttf"]


def pick_theme(slug, name=None):
    import zlib
    name = name if name in THEMES else list(THEMES)[zlib.crc32(str(slug).encode()) % len(THEMES)]
    return name, dict(THEMES[name])


def bgr(h):
    h = h.lstrip("#")
    return "&H" + h[4:6] + h[2:4] + h[0:2] + "&"


def text_w(text, size, _f={}):
    """Pixel width in the caption font, so a chunk never leaves the frame."""
    if size not in _f:
        _f[size] = None
        try:
            from PIL import ImageFont
            for p in BOLD_FONTS:
                if os.path.exists(p):
                    _f[size] = ImageFont.truetype(p, size)
                    break
        except Exception:
            pass
    f = _f[size]
    return f.getlength(text) if f else 0.66 * size * len(text)


def build_ass(words, path, accent="#FFB703", edge="#0F1530"):
    """Phrase chunks: at most 4 words, measured to fit, broken at commas and sentence ends; the spoken word is accent-coloured and larger."""
    outline = "&H00" + bgr(edge)[2:].rstrip("&")
    hdr = ("[Script Info]" + NL + "ScriptType: v4.00+" + NL + "PlayResX: 1080" + NL + "PlayResY: 1920" + NL + "WrapStyle: 2" + NL + NL + "[V4+ Styles]" + NL +
           "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding" + NL +
           f"Style: C,{FONT},{CAP_SIZE},&H00FFFFFF,&H00FFFFFF,{outline},&H00000000,1,0,0,0,100,100,0,0,1,7,2,2,60,60,520,1" + NL + NL +
           "[Events]" + NL + "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text" + NL)
    chunks, cur = [], []
    for wd in words:
        trial = cur + [wd]
        if cur and (len(trial) > 4 or text_w(" ".join(x[0] for x in trial), CAP_SIZE) * 1.1 > CAP_MAX_W):
            chunks.append(cur)
            cur = []
        cur.append(wd)
        if wd[0][-1:] in ".?!,;:":
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    hi = bgr(accent)
    BS = chr(92)
    ev = []
    for ci, chunk in enumerate(chunks):
        for i, (w, s, d) in enumerate(chunk):
            nxt = chunk[i + 1][1] if i + 1 < len(chunk) else min(s + d + 0.2, chunks[ci + 1][0][1] if ci + 1 < len(chunks) else 1e9)
            txt = " ".join(("{" + BS + "c" + hi + BS + "fscx112" + BS + "fscy112}" + x + "{" + BS + "r}") if j == i else x for j, (x, _, _) in enumerate(chunk))
            ev.append(f"Dialogue: 0,{ass_time(s)},{ass_time(nxt)},C,,0,0,0,,{txt}")
    Path(path).write_text(hdr + NL.join(ev) + NL, encoding="utf8")


def split_words(text, start, dur):
    ws = text.split()
    if not ws:
        return []
    total = sum(len(w) + 1 for w in ws)
    out, t = [], start
    for w in ws:
        d = dur * (len(w) + 1) / total
        out.append((w, t, d))
        t += d
    return out


def words_from_tokens(tokens, offset):
    """(word, start, duration) from Kokoro tokens. A punctuation-only token is glued to the word before it (the caption chunker breaks on a trailing , . ? !),
    a token with no time (None) inherits the end of the previous word so nothing is dropped."""
    out = []
    for tk in tokens or []:
        text = (getattr(tk, "text", "") or "").strip()
        if not text:
            continue
        st, en = getattr(tk, "start_ts", None), getattr(tk, "end_ts", None)
        if all(c in PUNCT for c in text):
            if out:
                w, s0, d0 = out[-1]
                out[-1] = (w + text, s0, d0)
            continue
        if st is None or en is None:
            st = (out[-1][1] - offset + out[-1][2]) if out else 0.0
            en = st + 0.18
        out.append((text, offset + st, max(en - st, 0.06)))
    return out


def speakable(text):
    """Dashes become a spoken comma (a model reads an em dash as nothing or as a glitch) and runs of spaces collapse."""
    return re.sub(r"\s+", " ", re.sub(r"\s*[—–]\s*", ", ", text)).strip()


def kokoro_beat(text, wav_path, t0, voice=None, _p={}):
    """Speak one beat in a single pass; write the mono wav and return (words with absolute times from t0, seconds)."""
    import numpy as np, soundfile as sf
    if "p" not in _p:
        from kokoro import KPipeline
        _p["p"] = KPipeline(lang_code="a", device="cpu")
    audio, words, off = [], [], 0.0
    for res in _p["p"](text, voice=voice or KOKORO_VOICE, speed=KOKORO_SPEED, split_pattern=r"\n+"):
        if res.audio is None:
            continue
        a = res.audio.detach().cpu().numpy() if hasattr(res.audio, "detach") else np.asarray(res.audio)
        words += words_from_tokens(res.tokens, t0 + off)
        off += len(a) / KOKORO_RATE
        audio.append(a)
    if not audio:
        raise RuntimeError("kokoro returned no audio")
    sf.write(str(wav_path), np.concatenate(audio), KOKORO_RATE)
    return words, off


def render(job, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    beats = job["beats"]
    t, allw, lst = 0.0, [], []
    for i, b in enumerate(beats):
        wav = out / f"b{i}.wav"
        if all(not s.get("audio_b64") for s in b["sentences"]):      # YT-VOICE-1: spoken here, whole beat at once
            try:
                src = out / f"b{i}.k.wav"
                ws, bt = kokoro_beat(speakable(" ".join(s["text"] for s in b["sentences"])), src, t, job.get("voice"))
            except Exception as e:      # the Worker reads "kokoro:" and re-voices the job with Aura on its next attempt
                raise RuntimeError("kokoro: " + repr(e)[:300])
            allw += ws
            dur = round(bt + 0.3, 2)
            b["dur"] = dur
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", "apad", "-t", str(dur), "-ar", "24000", "-ac", "1", str(wav)], check=True)
        else:
            parts, bt = [], 0.0
            for j, s in enumerate(b["sentences"]):
                f = out / f"b{i}s{j}.mp3"
                f.write_bytes(base64.b64decode(s["audio_b64"]))
                d = probe(f)
                allw += split_words(s["text"], t + bt, d)
                bt += d
                parts.append(f)
            dur = round(bt + 0.3, 2)   # tight beats; the voice already ends on a breath
            b["dur"] = dur
            (out / f"b{i}.txt").write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / f"b{i}.txt"), "-af", "apad", "-t", str(dur), "-ar", "24000", "-ac", "1", str(wav)], check=True)
        lst.append(f"file '{wav.as_posix()}'")
        t += dur
    (out / "a.txt").write_text("\n".join(lst) + "\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / "a.txt"), str(out / "audio.wav")], check=True)
    tname, theme = pick_theme(job.get("slug", job.get("title", "")), job.get("theme_name"))
    build_ass(allw, out / "cap.ass", theme["c2"], theme["bg"])
    spec = {"theme": theme, "beats": [{k: v for k, v in b.items() if k != "sentences"} for b in beats]}
    (out / "spec.json").write_text(json.dumps(spec), "utf8")
    env = dict(os.environ, SHORT_SPEC=str(out / "spec.json"), SHORT_FONT=FONT)
    m = subprocess.run([sys.executable, "-m", "manim", "render", "-qm", "--fps", "30", "-r", "1080,1920", "--media_dir", str(out / "media"),
                        "-o", "diagram", str(HERE / "short_scene.py"), "ShortScene"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if m.returncode != 0:      # YT-RENDER-ERR-1: the caller sees why, not only the exit status
        lines = [ln for ln in m.stderr.replace(CR, NL).split(NL) if ln.strip() and "it/s]" not in ln]
        raise RuntimeError("manim exit %s: %s" % (m.returncode, " | ".join(lines)[-900:]))
    silent = next((out / "media").rglob("diagram.mp4"))
    final = out / "short.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), "-i", str(out / "audio.wav"), "-vf", "subtitles=cap.ass",
                    "-af", "highpass=f=80,acompressor=threshold=0.125:ratio=3:attack=5:release=80,loudnorm=I=-16:TP=-1.5:LRA=7",
                    "-metadata", "comment=AI-generated: synthetic narration (text-to-speech) and generated animation from a QNFO plain-language paper summary",
                    "-metadata", "description=AI-generated content: synthetic narration and generated animation. Source: a QNFO plain-language paper summary (https://papers.qnfo.org).",   # YT-13: standard mp4 tags a player or a platform can read
                    "-metadata", "copyright=QNFO. AI-generated content.",
                    "-metadata", "title=" + str(job.get("title", ""))[:80], "-metadata", "artist=QNFO", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(final)],
                   check=True, cwd=out)
    import hashlib, datetime   # BP26-AI-ACT-ART50-1: machine-readable marking next to the file (the on-screen label is burned in)
    (out / "provenance.json").write_text(json.dumps({"ai_generated": True, "disclosure": "synthetic narration and generated animation", "video_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
                                                     "slug": job.get("slug"), "theme": tname, "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}, indent=1), "utf8")
    return {"path": str(final), "duration_s": round(t, 1), "bytes": final.stat().st_size}


if __name__ == "__main__":      # runner fallback: python render.py job.json outdir
    r = render(json.load(open(sys.argv[1], encoding="utf8")), sys.argv[2])
    print(json.dumps(r))
