"""Benchmark the local transcription endpoint using the same WAV on both hosts."""
import argparse
import json
import statistics
import time
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--language", choices=("en", "ja", "auto"), default="en")
    args = parser.parse_args()

    base = "http://127.0.0.1:11435"
    with urlopen(f"{base}/health", timeout=5) as response:
        print(json.load(response), flush=True)

    audio = args.wav.read_bytes()
    measurements = []
    for index in range(4):
        request = Request(
            f"{base}/transcribe",
            data=audio,
            headers={"Content-Type": "audio/wav", "X-Island-Language": args.language},
        )
        start = time.perf_counter()
        with urlopen(request, timeout=60) as response:
            text = json.load(response)["text"]
        seconds = time.perf_counter() - start
        label = "first request" if index == 0 else f"repeat {index}"
        print(f"{label}: {seconds:.2f}s {text}", flush=True)
        if index:
            measurements.append(seconds)
    print(f"median of repeats: {statistics.median(measurements):.2f}s")


if __name__ == "__main__":
    main()
