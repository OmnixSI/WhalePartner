#!/usr/bin/env python3
"""Persistent MLX Qwen3-TTS worker with utterance-level streaming audio."""

import base64
import json
import queue
import sys
import threading

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

protocol = sys.stdout
sys.stdout = sys.stderr

MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit"
STREAMING_INTERVAL_SECONDS = 0.96
INSTRUCT = {
    "neutral": "用自然、平和、亲切的语气说话。",
    "happy": "用开心、轻快、带着笑意的语气说话。",
    "sad": "用温柔、略带难过但仍关心对方的语气说话。",
    "angry": "用克制、略带不满但不尖刻的语气说话。",
    "surprised": "用惊喜、明亮的语气说话。",
    "relaxed": "用放松、柔和、从容的语气说话。",
}
commands = queue.Queue()
cancelled = set()
cancel_lock = threading.Lock()


def emit(message):
    protocol.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    protocol.flush()


def read_commands():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get("action") == "cancel":
                with cancel_lock:
                    cancelled.add(request.get("targetRequestId"))
            else:
                commands.put(request)
        except Exception as error:
            emit({"type": "error", "message": str(error)})
    commands.put({"action": "shutdown"})


def was_cancelled(request_id):
    with cancel_lock:
        return request_id in cancelled


def clear_cancel(request_id):
    with cancel_lock:
        cancelled.discard(request_id)


def synthesize(model, request):
    request_id = request.get("requestId")
    emotion = request.get("emotion", "neutral")
    text = request.get("text", "").strip()
    if emotion not in INSTRUCT:
        raise ValueError("Unsupported emotion")
    if not text:
        raise ValueError("TTS text is empty")

    for result in model.generate_custom_voice(
        text=text,
        speaker="Serena",
        language="Chinese",
        instruct=INSTRUCT[emotion],
        stream=True,
        streaming_interval=STREAMING_INTERVAL_SECONDS,
        verbose=False,
    ):
        if was_cancelled(request_id):
            clear_cancel(request_id)
            emit({"type": "cancelled", "requestId": request_id})
            return
        audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        emit({
            "type": "chunk",
            "requestId": request_id,
            "sampleRate": int(result.sample_rate),
            "pcm16": base64.b64encode(pcm).decode("ascii"),
        })
    clear_cancel(request_id)
    emit({"type": "done", "requestId": request_id})


def main():
    reader = threading.Thread(target=read_commands, daemon=True)
    reader.start()
    model = load_model(MODEL)
    # MLX compiles the Qwen audio path on first use. Do it before entering voice mode's ready state.
    for _ in model.generate_custom_voice(
        text="好。",
        speaker="Serena",
        language="Chinese",
        instruct=INSTRUCT["neutral"],
        stream=True,
        streaming_interval=STREAMING_INTERVAL_SECONDS,
        verbose=False,
    ):
        pass
    mx.clear_cache()
    emit({"type": "ready", "model": MODEL, "speaker": "Serena"})

    while True:
        request = commands.get()
        if request.get("action") == "shutdown":
            break
        try:
            if request.get("action") == "synthesize":
                synthesize(model, request)
            else:
                emit({"type": "error", "requestId": request.get("requestId"), "message": "Unknown TTS worker action"})
        except Exception as error:
            clear_cancel(request.get("requestId"))
            emit({"type": "error", "requestId": request.get("requestId"), "message": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        raise
