# 部署「家」后端（hub）

鲸汐的数据只放在一个地方：**家里的后端（hub）**。桌面 App、手机浏览器、另一台电脑都只是连到它，所以天然同步，也能实时一起看她回复。

三种用法，从简单到正式：

| 场景 | 做法 |
| --- | --- |
| 只在本机用 | 什么都不用配，桌面 App 自己带后端。 |
| 同一个 Wi-Fi 下的手机/平板 | `pnpm --dir apps/api run serve -- --lan`，手机打开日志里打印的地址。 |
| 外出也要用 | 下面 A（云服务器）或 B（cloudflared 隧道）。 |

## 令牌与配对

- 设了 `WP_LOCAL_TOKEN`、或开了 `--lan`/监听非本机地址时，**除 `/api/health` 和配对兑换外，所有接口都要令牌**。`--lan` 且没设 `WP_LOCAL_TOKEN` 时，启动时会生成一个临时令牌并打印。
- 令牌放在 `Authorization: Bearer <token>`；`EventSource`、`<img>` 带不了请求头，也接受 `?token=`。
- 第一台设备（持有 `WP_LOCAL_TOKEN` 的那台，通常是家里的桌面 App）在 **设置 › 我的设备 › 添加设备** 里生成二维码和 6 位配对码（10 分钟有效、只能用一次）。
- 新设备：扫码（手机浏览器会自动配对），或在 **设置 › 连接到我的鲸汐** 输入地址 + 配对码，换取长期设备令牌。设备令牌只存哈希，可在同一页撤销。
- 经隧道/反向代理过来的请求（带 `X-Forwarded-For`、`CF-Connecting-IP` 等头）一律要求令牌，即使没设 `WP_LOCAL_TOKEN`。
- 页面来自别的域名时，用 `WP_ALLOWED_ORIGINS=https://a.example,https://b.example` 放行；用域名访问时加 `WP_ALLOWED_HOSTS=home.example.com`（防 DNS rebinding）。

## A. 云服务器（Docker）

```bash
git clone https://github.com/OmnixSI/WhalePartner && cd WhalePartner
docker build -f apps/api/Dockerfile -t whalepartner-hub .
docker run -d --name whale --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v whale-data:/data \
  -e WP_LOCAL_TOKEN="$(openssl rand -base64 32)" \
  -e DEEPSEEK_API_KEY=sk-... \
  whalepartner-hub
```

镜像里已带网页端（`apps/client/dist`），打开 `https://你的域名/` 即可用，也可「添加到主屏幕」（PWA）。数据都在卷 `/data`（数据库、记忆、B 站登录、见闻封面，以及在「设置 › 模型接入」里保存的 `/data/.env`），备份它即可。

用 Caddy 反代并自动签 HTTPS（SSE 要关缓冲，Caddy 默认就是流式的）：

```
home.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Nginx 需要：`proxy_buffering off; proxy_read_timeout 1h;`（`/api/events` 与 `/api/chat` 是长连接 SSE）。

## B. cloudflared 隧道（不开端口，暴露本机 hub）

家里电脑上先正常运行后端（桌面 App 的后台运行，或 `pnpm --dir apps/api run serve`），并设置令牌：

```bash
export WP_LOCAL_TOKEN="$(openssl rand -base64 32)"   # 记在密码管理器里
pnpm --dir apps/api run serve
# 另一个终端：临时地址
cloudflared tunnel --url http://127.0.0.1:8787
```

得到 `https://xxxx.trycloudflare.com`。固定域名请用命名隧道（`cloudflared tunnel create` + `route dns`）。电脑休眠或关机时手机就连不上，需要常开的话用方案 A。

## 客户端怎么填

- 桌面 App / 另一台电脑：**设置 › 我的设备 › 连接到我的鲸汐**，填 `https://home.example.com` 和配对码。
- 手机：直接用浏览器打开该地址，或扫「添加设备」里的二维码。
- 想让桌面 App 一直连云端：配对后它就把远程地址存下来（`localStorage` 的 `wp.hub`），之后启动不再连本机后端；在同一页「断开，回到本机」即可恢复。

## 自检

```bash
curl https://home.example.com/api/health                      # 200，authRequired: true
curl https://home.example.com/api/memories                    # 401
curl -H "Authorization: Bearer $WP_LOCAL_TOKEN" https://home.example.com/api/devices
curl -N "https://home.example.com/api/events?token=$WP_LOCAL_TOKEN"   # SSE，每 15 秒一帧 : ping
```
