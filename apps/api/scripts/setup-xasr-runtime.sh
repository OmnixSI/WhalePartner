#!/usr/bin/env bash
set -euo pipefail

data_dir="${WP_DATA_DIR:-$HOME/Library/Application Support/com.omnixsi.whalepartner}"
runtime_dir="$data_dir/runtimes/asr-sherpa"
python_path="${WP_XASR_PYTHON:-}"

if [[ -z "$python_path" ]]; then
  python_path="$(command -v python3.12 || command -v python3 || true)"
fi
if [[ -z "$python_path" ]]; then
  echo "需要 Python 3.10 或更新版本来构建 X-ASR 本机运行时。" >&2
  exit 1
fi
if ! "$python_path" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "X-ASR 需要 Python 3.10 或更新版本：$python_path" >&2
  exit 1
fi

if [[ ! -x "$runtime_dir/bin/python" ]]; then
  mkdir -p "$(dirname "$runtime_dir")"
  "$python_path" -m venv "$runtime_dir"
fi
"$runtime_dir/bin/python" -m pip install --upgrade pip
"$runtime_dir/bin/python" -m pip install 'sherpa-onnx==1.13.8' 'numpy>=2,<3' pyinstaller
