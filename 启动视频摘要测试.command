#!/bin/zsh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$PROJECT_DIR/apps/api" || exit 1

if ! command -v node >/dev/null 2>&1; then
  print -u2 "没有找到 Node.js。请先安装本项目使用的 Node.js 运行环境。"
  read -r "?按回车键关闭窗口。"
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  print -u2 "没有找到 Codex CLI。请确认 Codex 已登录，并在终端中可以运行 codex。"
  read -r "?按回车键关闭窗口。"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  print -u2 "没有找到 FFmpeg。请先安装 FFmpeg 后重新启动。"
  read -r "?按回车键关闭窗口。"
  exit 1
fi

print "启动 WhalePartner 本地视频摘要测试台…"
print "首次打开浏览器后，粘贴 B 站链接或 BV 号即可开始。"
print "按 Control-C 停止服务。"
node src/dev-server.ts

print "本地服务已停止。"
read -r "?按回车键关闭窗口。"
