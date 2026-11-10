#!/usr/bin/env bash
set -euo pipefail

data_dir="${WP_DATA_DIR:?WP_DATA_DIR is required}"
model_dir="$data_dir/models/tts/cosyvoice3-mlx-fp16"
model_revision="18ccb7fbd7246e8cd3420d02f5dd28595cc0fcd9"
tokenizer_revision="b143914b3e912278104824da706edc9c2d317c4e"
model_repo="mlx-community/Fun-CosyVoice3-0.5B-2512-fp16"
tokenizer_repo="mlx-community/S3TokenizerV3"

download_file() {
  local repo="$1"
  local revision="$2"
  local file="$3"
  local destination_file="${4:-$file}"
  local destination="$model_dir/$destination_file"
  local temporary="$destination.download"

  if [ -s "$destination" ]; then
    return
  fi

  mkdir -p "$(dirname "$destination")"
  echo "Downloading $repo/$file" >&2
  curl --fail --location --retry 5 --retry-delay 2 --retry-all-errors --continue-at - \
    "https://huggingface.co/$repo/resolve/$revision/$file" -o "$temporary"
  mv "$temporary" "$destination"
}

mkdir -p "$model_dir"
download_file "$model_repo" "$model_revision" config.json
download_file "$model_repo" "$model_revision" model.safetensors
download_file "$model_repo" "$model_revision" tokenizer.json
download_file "$model_repo" "$model_revision" tokenizer_config.json
download_file "$tokenizer_repo" "$tokenizer_revision" config.json speech_tokenizer/config.json
download_file "$tokenizer_repo" "$tokenizer_revision" model.safetensors speech_tokenizer/model.safetensors
find "$model_dir" -name '*.download' -type f -delete

echo "CosyVoice3 MLX FP16 model is ready in $model_dir." >&2
