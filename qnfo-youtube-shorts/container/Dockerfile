# YT-VOICE-1: adds Kokoro TTS. YT-MANIM-PIN-1: manim 0.22.0 is the version the scene was written and tested on (0.18.1 has no Scene.time). YT-SERVER-1: render image for qnfo-youtube. Manim + ffmpeg + pango/cairo; serves /render on :8080.
FROM python:3.12-slim-bookworm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg libpango1.0-dev libcairo2-dev pkg-config gcc fonts-dejavu-core espeak-ng \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "manim==0.22.0"
# YT-VOICE-1: Kokoro-82M narrates on CPU (CPU-only torch keeps the layer near 200 MB); the warm-up bakes the model and spaCy data into the image so a render never downloads.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch  && pip install --no-cache-dir "kokoro>=0.9.4" soundfile  && python -c "from kokoro import KPipeline; p = KPipeline(lang_code='a', device='cpu'); print(sum(len(r.audio) for r in p('Warm up the voice.', voice='af_heart')))"
ENV HF_HUB_OFFLINE=1
WORKDIR /app
COPY short_scene.py render.py server.py /app/
EXPOSE 8080
CMD ["python", "-u", "/app/server.py"]
