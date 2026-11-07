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
ENV WP_STATIC_DIR=/app/apps/client/dist \
    APP_DB_PATH=/data/whalepartner.db \
    MEMORY_DIR=/data/memory \
    API_HOST=0.0.0.0 \
    API_PORT=8787
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 监听 0.0.0.0 且设了 WP_LOCAL_TOKEN：所有接口都要令牌；其他设备用配对码换设备 token。
CMD ["node", "--env-file-if-exists=.env", "src/server.ts"]
