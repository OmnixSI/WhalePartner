#!/usr/bin/env python3
"""Download only the files needed for CosyVoice3-0.5B inference."""

import sys
from pathlib import Path

from huggingface_hub import snapshot_download

MODEL_ID = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
MODEL_REVISION = "29e01c4e8d000f4bcd70751be16fa94bf3d85a18"
MODEL_FILES = [
    "cosyvoice3.yaml",
    "llm.pt",
    "flow.pt",
    "hift.pt",
    "campplus.onnx",
    "speech_tokenizer_v3.onnx",
    "CosyVoice-BlankEN/config.json",
    "CosyVoice-BlankEN/generation_config.json",
    "CosyVoice-BlankEN/merges.txt",
    "CosyVoice-BlankEN/model.safetensors",
    "CosyVoice-BlankEN/tokenizer_config.json",
    "CosyVoice-BlankEN/vocab.json",
]


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: prepare-cosyvoice3-model.py MODEL_DIRECTORY")
    target = Path(sys.argv[1]).expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        local_dir=str(target),
        allow_patterns=MODEL_FILES,
    )
    missing = [name for name in MODEL_FILES if not (target / name).is_file()]
    if missing:
        raise RuntimeError("CosyVoice3 model is incomplete: " + ", ".join(missing))
    print(f"Prepared {MODEL_ID}@{MODEL_REVISION} in {target}")


if __name__ == "__main__":
    main()
