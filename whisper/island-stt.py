import argparse
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

import numpy as np


def decode_pcm_wav(audio):
    with wave.open(io.BytesIO(audio), "rb") as clip:
        sample_rate = clip.getframerate()
        frames = clip.getnframes()
        if not (
            clip.getnchannels() == 1
            and clip.getsampwidth() == 2
            and 8000 <= sample_rate <= 96000
            and 0 < frames <= 8 * sample_rate
        ):
            raise ValueError("Expected short mono PCM WAV")
        pcm = clip.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError("Truncated PCM audio")

    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / np.float32(32768)
    if sample_rate != 16000:
        output_positions = np.arange(max(1, round(frames * 16000 / sample_rate))) * sample_rate / 16000
        samples = np.interp(output_positions, np.arange(frames), samples).astype(np.float32)
    return samples


def make_handler(model, settings):
    inference = threading.Lock()
    clients = threading.BoundedSemaphore(4)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def send_json(self, code, message):
            body = json.dumps(message, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            if self.client_address[0] == "127.0.0.1":
                return True
            self.send_json(403, {"error": "Source not allowed"})
            return False

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == "/health":
                self.send_json(200, {"status": "ready", "model": settings.model, "device": settings.device})
            else:
                self.send_json(404, {"error": "Not found"})

        def do_POST(self):
            if not self.allowed():
                return
            if self.path != "/transcribe":
                self.send_json(404, {"error": "Not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            manual = self.headers.get("X-Island-Manual") == "1"
            language = self.headers.get("X-Island-Language", "auto")
            hint = unquote(self.headers.get("X-Island-Name-Hint", ""))[:40].strip()
            if not 46 <= length <= 1048576 or language not in ("auto", "en", "ja"):
                self.send_json(400, {"error": "Invalid audio request"})
                return
            try:
                audio = self.rfile.read(length)
            except OSError:
                self.send_json(408, {"error": "Audio transfer timed out"})
                return
            try:
                if len(audio) != length:
                    raise ValueError("Incomplete request body")
                samples = decode_pcm_wav(audio)
            except (ValueError, wave.Error, EOFError):
                self.send_json(400, {"error": "Expected short mono PCM WAV"})
                return
            if not clients.acquire(blocking=False):
                self.send_json(503, {"error": "Transcription busy"})
                return
            try:
                if not inference.acquire(timeout=35):
                    self.send_json(503, {"error": "Transcription queue timed out"})
                    return
                try:
                    segments, _ = model.transcribe(
                        samples,
                        language=None if language == "auto" else language,
                        hotwords=hint or None,
                        beam_size=5,
                        condition_on_previous_text=False,
                        vad_filter=not manual,
                        vad_parameters={"min_silence_duration_ms": 250},
                    )
                    text = " ".join(segment.text.strip() for segment in segments).strip()
                finally:
                    inference.release()
            except Exception as error:
                self.log_error("Transcription failed: %r", error)
                self.send_json(500, {"error": "Transcription failed"})
                return
            finally:
                clients.release()
            self.send_json(200, {"text": text[:400]})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Island PoC local speech recognition")
    parser.add_argument("--model", choices=("small", "medium"), default="small")
    parser.add_argument("--threads", type=int, choices=range(1, 7), default=4)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    settings = parser.parse_args()

    from faster_whisper import WhisperModel

    compute_type = "float16" if settings.device == "cuda" else "int8"
    print(f"Loading Whisper {settings.model} on {settings.device} ({compute_type})...", flush=True)
    model = WhisperModel(
        settings.model, device=settings.device, compute_type=compute_type, cpu_threads=settings.threads
    )
    with ThreadingHTTPServer(("127.0.0.1", 11435), make_handler(model, settings)) as server:
        print("Whisper ready on http://127.0.0.1:11435", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
