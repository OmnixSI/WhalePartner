#!/usr/bin/env python3
"""Newline JSON bridge for the local sherpa-onnx X-ASR streaming recognizer."""

import base64
import json
import re
import sys

import numpy as np
from sherpa_onnx import OnlineRecognizer

protocol = sys.stdout
sys.stdout = sys.stderr


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
        sample_rate=16000,
        feature_dim=80,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4,
        rule2_min_trailing_silence=0.4,
        rule3_min_utterance_length=20.0,
        decoding_method="modified_beam_search",
        max_active_paths=4,
        modeling_unit="bpe",
        bpe_vocab=f"{model_dir}/bpe.vocab",
        model_type="",
    )


def main():
    if len(sys.argv) != 2:
        raise ValueError("Usage: xasr_worker.py MODEL_DIRECTORY")
    recognizer = create_recognizer(sys.argv[1])
    streams = {}
    emit({"type": "ready"})

    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            action = request.get("action")
            if action == "shutdown":
                break

            stream_id = request.get("streamId")
            if action == "start":
                streams[stream_id] = recognizer.create_stream()
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True})
            elif action == "audio":
                stream = streams[stream_id]
                pcm = base64.b64decode(request["pcm"], validate=True)
                if len(pcm) % 2:
                    raise ValueError("PCM16 audio needs an even number of bytes")
                samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
                stream.accept_waveform(16000, samples)
                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)
                text = normalize_text(recognizer.get_result(stream))
                final = recognizer.is_endpoint(stream)
                if final:
                    recognizer.reset(stream)
                emit({"type": "reply", "requestId": request.get("requestId"), "ok": True, "text": text, "final": final})
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
