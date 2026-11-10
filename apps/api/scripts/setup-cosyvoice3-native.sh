#!/usr/bin/env bash
set -euo pipefail

data_dir="${WP_DATA_DIR:?WP_DATA_DIR is required}"
runtime_dir="$data_dir/runtimes/tts-cosyvoice3-mlx-native"
previous_dir="$data_dir/runtimes/.cosyvoice3-native-previous"
source_dir="$data_dir/runtimes/.cosyvoice3-native-source"
work_dir="$data_dir/runtimes/.cosyvoice3-native-build"
revision="93cba1822e2be00e917206de74c23027e4cf74e7"
macos_major="$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)"
deployment_target="15.0"

if [ "$macos_major" -lt 15 ]; then
  echo "CosyVoice MLX native runtime requires macOS 15 or later." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "CosyVoice MLX native runtime requires Apple Silicon." >&2
  exit 1
fi

if [ -x "$runtime_dir/bin/cosyvoice3_server" ] && [ -f "$runtime_dir/bin/libmlx.dylib" ] && [ -f "$runtime_dir/bin/mlx.metallib" ] && [ "$(/bin/cat "$runtime_dir/deployment-target" 2>/dev/null || true)" = "$deployment_target" ]; then
  exit 0
fi

mkdir -p "$data_dir/runtimes"
rm -rf "$source_dir" "$work_dir" "$previous_dir"
finish_setup() {
  local status=$?
  rm -rf "$source_dir" "$work_dir"
  if [ "$status" -eq 0 ]; then
    rm -rf "$previous_dir"
  elif [ -d "$previous_dir" ]; then
    rm -rf "$runtime_dir"
    mv "$previous_dir" "$runtime_dir"
  fi
  return "$status"
}
trap finish_setup EXIT
if [ -d "$runtime_dir" ]; then
  mv "$runtime_dir" "$previous_dir"
fi
mkdir -p "$runtime_dir"
mkdir -p "$work_dir"
export UV_CACHE_DIR="$work_dir/uv-cache"
export UV_PYTHON_INSTALL_DIR="$work_dir/uv-python"
export PIP_CACHE_DIR="$work_dir/pip-cache"

echo "Preparing the MLX C++ build tools." >&2
python3 -m venv "$work_dir/bootstrap"
"$work_dir/bootstrap/bin/python" -m pip install --disable-pip-version-check --quiet "uv==0.5.31"
uv="$work_dir/bootstrap/bin/uv"
"$uv" venv -q -p 3.12 --allow-existing "$work_dir/venv"

git init -q "$source_dir"
git -C "$source_dir" remote add origin https://github.com/sgl-project/sglang-omni.git
git -C "$source_dir" fetch --quiet --depth 1 --filter=blob:none origin "$revision"
git -C "$source_dir" sparse-checkout init --cone
git -C "$source_dir" sparse-checkout set sglang_omni_mlx/native
git -C "$source_dir" checkout --detach -q FETCH_HEAD
native_dir="$source_dir/sglang_omni_mlx/native"

MACOSX_DEPLOYMENT_TARGET="$deployment_target" VIRTUAL_ENV="$work_dir/venv" "$uv" pip install -q \
  --python-platform aarch64-apple-darwin -r "$native_dir/scripts/build-tools.lock"
mlx_dir="$("$work_dir/venv/bin/python" -c 'import mlx.core, os; print(os.path.join(os.path.dirname(mlx.core.__file__), "share/cmake/MLX"))')"
export PATH="$work_dir/venv/bin:$PATH"

echo "Building the native CosyVoice3 server." >&2
cmake -S "$native_dir" -B "$work_dir/cmake" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DMLX_DIR="$mlx_dir" -DCMAKE_INSTALL_PREFIX="$runtime_dir" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$deployment_target" -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build "$work_dir/cmake" --parallel 6
cmake --install "$work_dir/cmake"

for file in "$runtime_dir"/bin/*; do
  name="${file##*/}"
  case "$name" in
    cosyvoice3_server|*.dylib|mlx.metallib) ;;
    *) rm -f "$file" ;;
  esac
done

mkdir -p "$runtime_dir/licenses"
cp "$source_dir/LICENSE" "$runtime_dir/licenses/sglang-omni-LICENSE"
rm -f "$runtime_dir/licenses/music3-MIT.txt"
printf '%s\n' "$deployment_target" > "$runtime_dir/deployment-target"
chmod 755 "$runtime_dir/bin/cosyvoice3_server"
test -f "$runtime_dir/bin/libmlx.dylib"
test -f "$runtime_dir/bin/mlx.metallib"
echo "CosyVoice3 native MLX runtime is ready." >&2
