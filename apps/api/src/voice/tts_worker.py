#!/usr/bin/env python3
"""Persistent CosyVoice3 worker for local Big Fish speech replies."""

import base64
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path

SOURCE_DIR = os.environ["WP_COSYVOICE_SOURCE_DIR"]
MODEL_DIR = os.environ["WP_COSYVOICE_MODEL_DIR"]
REFERENCE_AUDIO = os.environ["WP_COSYVOICE_REFERENCE_AUDIO"]
REFERENCE_TEXT_PATH = os.environ["WP_COSYVOICE_REFERENCE_TEXT"]
sys.path.insert(0, os.path.join(SOURCE_DIR, "third_party", "Matcha-TTS"))
sys.path.insert(0, SOURCE_DIR)

import numpy as np
import torch
from cosyvoice.cli.cosyvoice import CosyVoice3

protocol = sys.stdout
sys.stdout = sys.stderr

MODEL = "Fun-CosyVoice3-0.5B-2512"
SAMPLE_RATE = 24000
VOICE_INSTRUCTION = "You are a helpful assistant. 请用平静、自然的语气说话，语速自然，停顿自然，情绪克制，像轻松交谈一样。<|endofprompt|>"
REFERENCE_TEXT = Path(REFERENCE_TEXT_PATH).read_text(encoding="utf-8").strip()
if not REFERENCE_TEXT:
    raise ValueError("大肥鱼参考文本为空。")
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
    text = request.get("text", "").strip()
    if not text:
        raise ValueError("TTS text is empty")
    if not os.path.isfile(REFERENCE_AUDIO):
        raise FileNotFoundError("等待大肥鱼参考音频。")

    started_at = time.perf_counter()
    for chunk_index, result in enumerate(model.inference_zero_shot(
        tts_text=text,
        prompt_text=VOICE_INSTRUCTION + REFERENCE_TEXT,
        prompt_wav=REFERENCE_AUDIO,
        stream=True,
        speed=1.0,
    )):
        if was_cancelled(request_id):
            clear_cancel(request_id)
            emit({"type": "cancelled", "requestId": request_id})
            return
        audio = result["tts_speech"].detach().float().cpu().numpy().reshape(-1)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        emitted_at = time.perf_counter()
        emit({
            "type": "chunk",
            "requestId": request_id,
            "chunkIndex": chunk_index,
            "elapsedMs": round((emitted_at - started_at) * 1000, 1),
            "audioDurationMs": round(len(audio) / SAMPLE_RATE * 1000, 1),
            "sampleRate": SAMPLE_RATE,
            "pcm16": base64.b64encode(pcm).decode("ascii"),
        })
    clear_cancel(request_id)
    emit({"type": "done", "requestId": request_id})


def main():
    reader = threading.Thread(target=read_commands, daemon=True)
    reader.start()
    if not torch.backends.mps.is_available():
        raise RuntimeError("CosyVoice3 本地推理需要可用的 Apple Silicon MPS。")
    model = CosyVoice3(MODEL_DIR, fp16=False)
    emit({"type": "ready", "model": MODEL, "speaker": "大肥鱼预设音色"})

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
