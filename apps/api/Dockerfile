# 鲸汐「家」后端（hub）镜像：API + 网页端（PWA）一起托管。
# 在仓库根目录构建：  docker build -f apps/api/Dockerfile -t whalepartner-hub .
# 运行：              docker run -d --name whale -p 8787:8787 -v whale-data:/data \
#                       -e WP_LOCAL_TOKEN=换成一串长随机字符 -e DEEPSEEK_API_KEY=sk-... whalepartner-hub

FROM node:26-slim AS client
WORKDIR /app/apps/client
RUN corepack enable
COPY apps/client/package.json apps/client/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY apps/client ./
RUN pnpm exec vite build

FROM node:26-slim
WORKDIR /app/apps/api
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY apps/api/package.json apps/api/pnpm-lock.yaml* apps/api/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY apps/api ./
COPY --from=client /app/apps/client/dist /app/apps/client/dist
# 所有数据（B 站登录、见闻封面、设置里保存的密钥 .env）都放在卷 /data；数据库沿用原来的文件名。
ENV WP_STATIC_DIR=/app/apps/client/dist \
    WP_DATA_DIR=/data \
    APP_DB_PATH=/data/whalepartner.db \
    MEMORY_DIR=/data/memory \
    API_HOST=0.0.0.0 \
    API_PORT=8787 \
    WP_TRUSTED_PROXIES=172.16.0.0/12
# 容器里看到的 TCP 对端是 Docker bridge 网关（如 172.17.0.1），不是 127.0.0.1。把 Docker 的私有网段当作代理，
# 配对码限流才会按 X-Forwarded-For 里的真实客户端分桶，否则所有人共用一个桶。用 --network host 或别的网段时改写这个变量。
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 监听 0.0.0.0 且设了 WP_LOCAL_TOKEN：所有接口都要令牌；其他设备用配对码换设备 token。
CMD ["node", "--env-file-if-exists=.env", "--env-file-if-exists=/data/.env", "src/server.ts"]
