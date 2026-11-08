#!/usr/bin/env bash
set -euo pipefail

data_dir="${WP_DATA_DIR:-$HOME/Library/Application Support/com.omnixsi.whalepartner}"
runtime_dir="$data_dir/runtimes/tts-mlx"
python_path="${WP_TTS_PYTHON:-}"

if [[ -z "$python_path" ]]; then
  python_path="$(command -v python3.12 || command -v python3 || true)"
fi
if [[ -z "$python_path" ]]; then
  echo "需要 Python 3.10 或更新版本来安装本地语音合成。" >&2
  exit 1
fi
if ! "$python_path" -c 'import platform, sys; raise SystemExit(0 if sys.platform == "darwin" and platform.machine() == "arm64" and sys.version_info >= (3, 10) else 1)'; then
  echo "本地语音合成需要 Apple Silicon Mac 和 Python 3.10 或更新版本。" >&2
  exit 1
fi

if [[ ! -x "$runtime_dir/bin/python" ]]; then
  mkdir -p "$(dirname "$runtime_dir")"
  "$python_path" -m venv "$runtime_dir"
fi
"$runtime_dir/bin/python" -m pip install --upgrade pip
"$runtime_dir/bin/python" -m pip install 'mlx-audio==0.6.4'
