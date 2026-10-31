# ClipPilot video worker — FFmpeg + faster-whisper + OpenCV (CPU).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    WHISPER_MODEL_DIR=/models WORKER_TMP_DIR=/tmp/clippilot

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY fonts ./fonts
COPY clippilot_worker ./clippilot_worker

# Pre-download the Whisper model at build time so containers start fast.
ARG WHISPER_MODEL=small
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8', download_root='/models')"

RUN useradd --create-home --uid 10001 worker && mkdir -p /tmp/clippilot && chown -R worker /tmp/clippilot /models
USER worker

HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import shutil,sys; sys.exit(0 if shutil.which('ffmpeg') else 1)"
CMD ["python", "-m", "clippilot_worker.main"]
