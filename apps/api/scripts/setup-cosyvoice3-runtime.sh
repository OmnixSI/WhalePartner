#!/usr/bin/env bash
set -euo pipefail

data_dir="${WP_DATA_DIR:-$HOME/Library/Application Support/com.omnixsi.whalepartner}"
runtime_dir="$data_dir/runtimes/tts-cosyvoice3"
source_dir="$data_dir/runtimes/cosyvoice3-source"
source_commit="9060a7a641c62ac47ce179191c7cd4aea4af919a"
script_dir="$(cd "$(dirname "$0")" && pwd)"
python_path="${WP_TTS_PYTHON:-}"

if [[ -z "$python_path" ]]; then
  for candidate in python3.12 python3.11 python3.10; do
    python_path="$(command -v "$candidate" || true)"
    if [[ -n "$python_path" ]]; then break; fi
  done
fi
if [[ -z "$python_path" ]]; then
  if [[ -x /opt/anaconda3/bin/python3.12 ]]; then python_path=/opt/anaconda3/bin/python3.12; fi
fi
if [[ -z "$python_path" ]]; then
  echo "CosyVoice3 需要 Python 3.10–3.12。" >&2
  exit 1
fi
if ! "$python_path" -c 'import platform, sys; raise SystemExit(0 if sys.platform == "darwin" and platform.machine() == "arm64" and (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)'; then
  echo "CosyVoice3 本地推理需要 Apple Silicon Mac 和 Python 3.10–3.12。" >&2
  exit 1
fi

mkdir -p "$(dirname "$runtime_dir")"
if [[ ! -x "$runtime_dir/bin/python" ]]; then
  "$python_path" -m venv "$runtime_dir"
fi
"$runtime_dir/bin/python" -m pip install --upgrade pip
"$runtime_dir/bin/python" -m pip install -r "$script_dir/cosyvoice-requirements.txt"
"$runtime_dir/bin/python" -m pip install 'setuptools<81'
"$runtime_dir/bin/python" -m pip install --no-build-isolation --no-deps 'openai-whisper==20231117'

if [[ ! -d "$source_dir/.git" ]]; then
  if [[ -e "$source_dir" ]]; then
    echo "CosyVoice source directory exists but is not a Git checkout: $source_dir" >&2
    exit 1
  fi
  mkdir -p "$source_dir"
  git -C "$source_dir" init -q
  git -C "$source_dir" remote add origin https://github.com/ZoneTwelve/CosyVoice-MPS.git
fi
git -C "$source_dir" fetch --depth 1 origin "$source_commit"
git -C "$source_dir" checkout --detach -q FETCH_HEAD
git -C "$source_dir" submodule update --init --depth 1

"$runtime_dir/bin/python" -c 'import torch, torchaudio, onnxruntime; print("PyTorch", torch.__version__, "MPS", torch.backends.mps.is_available()); assert torch.backends.mps.is_available(); import sys; sys.path[:0] = [sys.argv[1] + "/third_party/Matcha-TTS", sys.argv[1]]; from cosyvoice.cli.cosyvoice import CosyVoice3; print("CosyVoice3 import OK")' "$source_dir"
