#!/usr/bin/env python3
"""Newline JSON bridge for the local two-pass sherpa-onnx X-ASR recognizer."""

import base64
import json
import re
import sys
import threading

import numpy as np
from sherpa_onnx import OfflineRecognizer, OnlineRecognizer

protocol = sys.stdout
sys.stdout = sys.stderr

SAMPLE_RATE = 16_000
BASE_RMS_THRESHOLD = 0.008
END_SILENCE_SAMPLES = 11_200
MIN_SPEECH_SAMPLES = 8_000
PRE_ROLL_SAMPLES = 4_000
STREAMING_TAIL_PADDING_SAMPLES = 6_400
OFFLINE_TAIL_PADDING_SAMPLES = 4_800


def emit(message):
    protocol.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    protocol.flush()


def normalize_text(text):
    cjk = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
    text = re.sub(fr"([{cjk}])\s+([{cjk}])", r"\1\2", text)
    text = re.sub(fr"([{cjk}])\s+([，。！？、；：,.!?;:])", r"\1\2", text)
    return re.sub(r"([，。！？、；：])\s+", r"\1", text).strip()


def create_recognizer(model_dir):
    return OnlineRecognizer.from_transducer(
        tokens=f"{model_dir}/tokens.txt",
        encoder=f"{model_dir}/encoder.int8.onnx",
        decoder=f"{model_dir}/decoder.onnx",
        joiner=f"{model_dir}/joiner.int8.onnx",
        num_threads=2,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        enable_endpoint_detection=False,
        decoding_method="modified_beam_search",
        max_active_paths=4,
        modeling_unit="bpe",
        bpe_vocab=f"{model_dir}/bpe.vocab",
        model_type="",
    )


def create_offline_recognizer(model_dir):
    return OfflineRecognizer.from_transducer(
        tokens=f"{model_dir}/tokens.txt",
        encoder=f"{model_dir}/encoder-epoch-99-avg-1.int8.onnx",
        decoder=f"{model_dir}/decoder-epoch-99-avg-1.onnx",
        joiner=f"{model_dir}/joiner-epoch-99-avg-1.int8.onnx",
        num_threads=2,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        decoding_method="modified_beam_search",
        max_active_paths=4,
        modeling_unit="bpe",
        bpe_vocab=f"{model_dir}/bpe.vocab",
        model_type="transducer",
    )


def new_stream_state(recognizer):
    return {
        "stream": recognizer.create_stream(),
        "active": False,
        "audio": [],
        "pre_roll": np.empty(0, dtype=np.int16),
        "silence_samples": 0,
        "speech_samples": 0,
        "noise_floor": 0.0,
        "last_hypothesis": "",
    }


def consume_vad_frame(state, samples):
    if not samples.size:
        return False, False
    normalized = samples.astype(np.float32) / 32768.0
    level = float(np.sqrt(np.mean(normalized * normalized)))
    noise_floor = state["noise_floor"]
    threshold = max(BASE_RMS_THRESHOLD, min(0.03, noise_floor * 3))
    is_speech = level >= threshold
    if noise_floor == 0:
        state["noise_floor"] = min(level, 0.01)
    elif level < noise_floor:
        state["noise_floor"] = noise_floor * 0.8 + level * 0.2
    else:
        state["noise_floor"] = noise_floor * 0.998 + level * 0.002

    if not state["active"]:
        if not is_speech:
            state["pre_roll"] = np.concatenate((state["pre_roll"], samples))[-PRE_ROLL_SAMPLES:]
            return False, False
        state["active"] = True
        state["audio"] = [state["pre_roll"].copy(), samples.copy()]
        state["speech_samples"] = samples.size
        state["silence_samples"] = 0
        return True, False

    state["audio"].append(samples.copy())
    if is_speech:
        state["speech_samples"] += samples.size
        state["silence_samples"] = 0
    else:
        state["silence_samples"] += samples.size
    return False, state["silence_samples"] >= END_SILENCE_SAMPLES


def decode_ready(recognizer, stream):
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)


def refine_utterance(offline_recognizer, chunks, streaming_text, speech_samples):
    if offline_recognizer is None:
        return streaming_text
    try:
        samples = np.concatenate(chunks) if chunks else np.empty(0, dtype=np.int16)
        # 用真正的语音采样数判断长短：句末静音会把 chunks 撑过 0.5 秒，不能拿它当依据。
        if speech_samples < MIN_SPEECH_SAMPLES:
            return streaming_text
        audio = samples.astype(np.float32) / 32768.0
        audio = np.concatenate((audio, np.zeros(OFFLINE_TAIL_PADDING_SAMPLES, dtype=np.float32)))
        stream = offline_recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        offline_recognizer.decode_stream(stream)
        refined = normalize_text(stream.result.text)
        return refined or streaming_text
    except Exception as error:
        print(f"X-ASR 整句精修失败，保留流式结果：{error}", file=sys.stderr)
        return streaming_text


def finish_utterance(recognizer, offline_recognizer, state):
    stream = state["stream"]
    padding = np.zeros(STREAMING_TAIL_PADDING_SAMPLES, dtype=np.float32)
    stream.accept_waveform(SAMPLE_RATE, padding)
    stream.input_finished()
    decode_ready(recognizer, stream)
    streaming_text = normalize_text(recognizer.get_result(stream))
    # 短语音（< MIN_SPEECH_SAMPLES）也要交回流式结果：refine_utterance 只跳过整句精修，
    # 不再把已经识别出的文本丢掉。
    utterance_text = refine_utterance(offline_recognizer, state["audio"], streaming_text, state["speech_samples"])
    state["stream"] = recognizer.create_stream()
    state["active"] = False
    state["pre_roll"] = np.concatenate(state["audio"])[-PRE_ROLL_SAMPLES:] if state["audio"] else np.empty(0, dtype=np.int16)
    state["audio"] = []
    state["silence_samples"] = 0
    state["speech_samples"] = 0
    state["last_hypothesis"] = ""
    return utterance_text


def load_recognizers(streaming_dir, offline_dir):
    """两个模型并行载入（#149）：sherpa-onnx 载入时释放 GIL，比先后载入省约 0.7 秒。"""
    offline = {}

    def load_offline():
        try:
            offline["recognizer"] = create_offline_recognizer(offline_dir)
        except Exception as error:
            print(f"X-ASR 整句精修模型载入失败：{error}", file=sys.stderr)

    loader = threading.Thread(target=load_offline, daemon=True) if offline_dir else None
    if loader:
        loader.start()
    recognizer = create_recognizer(streaming_dir)
    if loader:
        loader.join()
    return recognizer, offline.get("recognizer")


def main():
    if len(sys.argv) != 3:
        raise ValueError("Usage: xasr_worker.py STREAMING_MODEL_DIRECTORY OFFLINE_MODEL_DIRECTORY")
    recognizer, offline_recognizer = load_recognizers(sys.argv[1], sys.argv[2])
    streams = {}
    emit({"type": "ready", "refinementReady": offline_recognizer is not None})

    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            action = request.get("action")
            if action == "shutdown":
                break

            stream_id = request.get("streamId")
            if action == "start":
                streams[stream_id] = new_stream_state(recognizer)
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True})
            elif action == "audio":
                state = streams[stream_id]
                pcm = base64.b64decode(request["pcm"], validate=True)
                if len(pcm) % 2:
                    raise ValueError("PCM16 audio needs an even number of bytes")
                pcm_samples = np.frombuffer(pcm, dtype="<i2")
                started, ended = consume_vad_frame(state, pcm_samples)
                if state["active"]:
                    stream_samples = np.concatenate((state["pre_roll"], pcm_samples)) if started else pcm_samples
                    state["stream"].accept_waveform(SAMPLE_RATE, stream_samples.astype(np.float32) / 32768.0)
                    decode_ready(recognizer, state["stream"])
                text = ""
                final = False
                if ended:
                    final = True
                    if state["speech_samples"] > 0:
                        # 只要有过语音就交回结果；短语音由 refine_utterance 直接回流式文本。
                        text = finish_utterance(recognizer, offline_recognizer, state)
                    else:
                        state["stream"].input_finished()
                        state["stream"] = recognizer.create_stream()
                        state["active"] = False
                        state["pre_roll"] = np.concatenate(state["audio"])[-PRE_ROLL_SAMPLES:]
                        state["audio"] = []
                        state["silence_samples"] = 0
                        state["speech_samples"] = 0
                        state["last_hypothesis"] = ""
                elif state["active"]:
                    text = normalize_text(recognizer.get_result(state["stream"]))
                    if text == state["last_hypothesis"]:
                        text = ""
                    else:
                        state["last_hypothesis"] = text
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True, "text": text, "final": final})
            elif action == "finish":
                state = streams[stream_id]
                text = ""
                if state["active"] and state["speech_samples"] > 0:
                    text = finish_utterance(recognizer, offline_recognizer, state)
                else:
                    state["stream"] = recognizer.create_stream()
                    state["active"] = False
                    state["audio"] = []
                    state["silence_samples"] = 0
                    state["speech_samples"] = 0
                    state["last_hypothesis"] = ""
                state["pre_roll"] = np.empty(0, dtype=np.int16)
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True, "text": text, "final": True})
            elif action == "close":
                streams.pop(stream_id, None)
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True})
            else:
                raise ValueError("Unknown X-ASR worker action")
        except Exception as error:  # Return request errors without killing the shared model process.
            emit({"type": "reply", "requestId": request.get("requestId"), "ok": False, "message": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        raise
