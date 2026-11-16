FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir faster-whisper==1.2.1 \
    && useradd --create-home --uid 10001 whisper \
    && install -d -o whisper -g whisper /models
ENV HF_HOME=/models PYTHONUNBUFFERED=1
WORKDIR /app
COPY --chmod=644 island-stt.py ./
USER whisper
CMD ["python", "island-stt.py"]
