#!/bin/bash
# 双击启动「鲸汐」：先确认后端在跑，再打开桌面 App。
# 后端没起来时会在后台拉起来，日志写到 /tmp/whalepartner-api.log。
set -e
cd "$(dirname "$0")"

health() { curl -s -m 2 -o /dev/null "http://127.0.0.1:8787/api/health"; }

if ! health; then
  echo "后端没在跑，先启动它…"
  (pnpm --dir apps/api run serve > /tmp/whalepartner-api.log 2>&1 &)
  for _ in $(seq 1 30); do
    health && break
    sleep 1
  done
  if ! health; then
    echo "后端启动失败，看看 /tmp/whalepartner-api.log"
    exit 1
  fi
  echo "后端就绪：http://127.0.0.1:8787"
fi

open -a "鲸汐"
echo "已打开「鲸汐」。关掉后端：lsof -ti:8787 | xargs kill"
