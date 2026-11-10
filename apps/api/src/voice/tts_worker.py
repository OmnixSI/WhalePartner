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
VOICE_PROFILE_PATH = os.environ["WP_COSYVOICE_PROFILE_PATH"]
VOICE_METADATA_PATH = os.environ["WP_COSYVOICE_METADATA_PATH"]
sys.path.insert(0, os.path.join(SOURCE_DIR, "third_party", "Matcha-TTS"))
sys.path.insert(0, SOURCE_DIR)

import numpy as np
import torch
from cosyvoice.cli.cosyvoice import CosyVoice3

protocol = sys.stdout
sys.stdout = sys.stderr

MODEL = "Fun-CosyVoice3-0.5B-2512"
MODEL_REPO = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
SAMPLE_RATE = 24000
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


def load_voice_profile(model):
    metadata = json.loads(Path(VOICE_METADATA_PATH).read_text(encoding="utf-8"))
    if metadata.get("model") != MODEL_REPO:
        raise ValueError("大肥鱼音色配置与当前 CosyVoice3 模型不匹配。")
    voice_id = metadata.get("id")
    transcript = metadata.get("transcript", "").strip()
    if not isinstance(voice_id, str) or not voice_id or not voice_id.replace("_", "").replace("-", "").isalnum():
        raise ValueError("大肥鱼音色配置缺少有效标识。")
    if not transcript:
        raise ValueError("大肥鱼音色配置缺少参考文本。")

    profile = torch.load(VOICE_PROFILE_PATH, map_location="cpu", weights_only=True)
    required = {
        "prompt_text", "prompt_text_len", "llm_prompt_speech_token", "llm_prompt_speech_token_len",
        "flow_prompt_speech_token", "flow_prompt_speech_token_len", "prompt_speech_feat",
        "prompt_speech_feat_len", "llm_embedding", "flow_embedding",
    }
    if not isinstance(profile, dict) or not required.issubset(profile):
        raise ValueError("大肥鱼音色配置缺少 CosyVoice 所需的说话人特征。")
    if any(not isinstance(value, torch.Tensor) for value in profile.values()):
        raise ValueError("大肥鱼音色配置包含无法识别的数据。")

    prompt_text = model.frontend.tokenizer.decode(profile["prompt_text"][0].tolist())
    if transcript not in prompt_text:
        raise ValueError("大肥鱼音色配置中的参考文本与配置说明不一致。")
    model.frontend.spk2info[voice_id] = {
        key: value.to(model.frontend.device) for key, value in profile.items()
    }
    return voice_id


def clear_cancel(request_id):
    with cancel_lock:
        cancelled.discard(request_id)


def synthesize(model, request, voice_id):
    request_id = request.get("requestId")
    text = request.get("text", "").strip()
    if not text:
        raise ValueError("TTS text is empty")
    started_at = time.perf_counter()
    for chunk_index, result in enumerate(model.inference_zero_shot(
        tts_text=text,
        prompt_text="",
        prompt_wav="",
        zero_shot_spk_id=voice_id,
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
    voice_id = load_voice_profile(model)
    emit({"type": "ready", "model": MODEL, "speaker": "大肥鱼预设音色"})

    while True:
        request = commands.get()
        if request.get("action") == "shutdown":
            break
        try:
            if request.get("action") == "synthesize":
                synthesize(model, request, voice_id)
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
