#!/usr/bin/env python3
"""Persistent MLX Qwen3-TTS worker with utterance-level streaming audio."""

import base64
import json
import queue
import sys
import threading
import time

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

protocol = sys.stdout
sys.stdout = sys.stderr

MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit"
STREAMING_INTERVAL_SECONDS = 2.0
DEEPSEEK_VOICE_STYLE = "清澈柔和、明亮温暖的年轻女性中文声线，带一点轻盈俏皮感，像亲切而有活力的朋友在近距离陪伴聊天。语速自然适中，咬字清楚，句尾有柔和起伏；避免童声、尖细夹嗓、夸张撒娇和播音腔。"
EMOTION_STYLE = {
    "neutral": "情绪平静自然，语气温和，不冷淡。",
    "happy": "开心明亮，带轻微笑意，语调轻快但不过度兴奋。",
    "sad": "柔和共情，语速稍缓，克制温暖，不要哭腔。",
    "angry": "坚定有力量但保持克制，不吼叫，不尖锐。",
    "surprised": "带一点惊喜和意外，语调稍扬但不夸张。",
    "relaxed": "放松轻柔，节奏舒缓，像安心地闲聊。",
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
    text = request.get("text", "").strip()
    if not text:
        raise ValueError("TTS text is empty")

    started_at = time.perf_counter()
    chunk_index = 0
    character_id = request.get("characterId")
    emotion = request.get("emotion", "neutral")
    instruct = None
    if character_id == "deepseek":
        instruct = DEEPSEEK_VOICE_STYLE + " " + EMOTION_STYLE.get(emotion, EMOTION_STYLE["neutral"])
    for result in model.generate_custom_voice(
        text=text,
        speaker="Serena",
        language="Chinese",
        instruct=instruct,
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
        emitted_at = time.perf_counter()
        emit({
            "type": "chunk",
            "requestId": request_id,
            "chunkIndex": chunk_index,
            "elapsedMs": round((emitted_at - started_at) * 1000, 1),
            "audioDurationMs": round(len(audio) / result.sample_rate * 1000, 1),
            "sampleRate": int(result.sample_rate),
            "pcm16": base64.b64encode(pcm).decode("ascii"),
        })
        chunk_index += 1
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
