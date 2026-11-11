import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readJsonBody, sendJson } from "../server/http.ts";
import { authorize, type AuthOptions, type AuthVerdict } from "../hub/auth.ts";
import type { DeviceConnections } from "../hub/device-connections.ts";
import { isEmotion } from "../chat/emotion.ts";
import type { AsrService, AsrStream } from "../voice/asr.ts";
import { TTS_MAX_TEXT_LENGTH, type TtsService } from "../voice/tts.ts";

const STREAM_PATH = "/api/voice/asr/stream";
const MAX_PCM_FRAME_BYTES = 32 * 1024;

export async function handleVoiceRoute(asr: AsrService, tts: TtsService, request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === "/api/voice/asr/status" && request.method === "GET") {
    sendJson(response, 200, asr.status());
    return true;
  }
  if (pathname === "/api/voice/asr/warm" && request.method === "POST") {
    try {
      await asr.warm();
      sendJson(response, 200, asr.status());
    } catch (error) {
      sendJson(response, 503, { ...asr.status(), message: error instanceof Error ? error.message : "本地 X-ASR 模型准备失败。" });
    }
    return true;
  }
  if (pathname === "/api/voice/asr/rebuild" && request.method === "POST") {
    try {
      await asr.rebuild();
      sendJson(response, 200, asr.status());
    } catch (error) {
      sendJson(response, 503, { ...asr.status(), message: error instanceof Error ? error.message : "重建本地 X-ASR 环境失败。" });
    }
    return true;
  }
  if (pathname === "/api/voice/tts/status" && request.method === "GET") {
    sendJson(response, 200, tts.status());
    return true;
  }
  if (pathname === "/api/voice/tts/warm" && request.method === "POST") {
    try {
      await tts.warm();
      sendJson(response, 200, tts.status());
    } catch (error) {
      sendJson(response, 503, { ...tts.status(), message: error instanceof Error ? error.message : "本地语音模型准备失败。" });
    }
    return true;
  }
  if (pathname === "/api/voice/tts/rebuild" && request.method === "POST") {
    try {
      await tts.rebuild();
      sendJson(response, 200, tts.status());
    } catch (error) {
      sendJson(response, 503, { ...tts.status(), message: error instanceof Error ? error.message : "重建本地语音环境失败。" });
    }
    return true;
  }
  if (pathname === "/api/voice/tts/stream" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { error: "invalid_request", message: error instanceof Error ? error.message : "请求内容无效。" });
      return true;
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    const segmentIndex = Number.isInteger(body.segmentIndex) ? Number(body.segmentIndex) : undefined;
    const emotion = typeof body.emotion === "string" && isEmotion(body.emotion) ? body.emotion : "neutral";
    const characterId = typeof body.characterId === "string" && body.characterId.length <= 32 ? body.characterId : undefined;
    if (!text || text.length > TTS_MAX_TEXT_LENGTH || !turnId || turnId.length > 100) {
      sendJson(response, 400, { error: "invalid_request", message: "语音文本或对话轮次无效。" });
      return true;
    }
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", abort);
    response.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    response.write(`${JSON.stringify({ type: "meta", model: tts.status().model, speaker: tts.status().speaker, turnId, segmentIndex })}\n`);
    try {
      await tts.stream(text, (chunk) => {
        if (!controller.signal.aborted && !response.destroyed) response.write(`${JSON.stringify({ type: "audio", ...chunk, turnId, segmentIndex })}\n`);
      }, controller.signal, { turnId, segmentIndex, emotion, characterId });
      if (!controller.signal.aborted && !response.destroyed) response.end(`${JSON.stringify({ type: "done", turnId, segmentIndex })}\n`);
    } catch (error) {
      if (!controller.signal.aborted && !response.destroyed) {
        response.write(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "本地语音生成失败。", turnId, segmentIndex })}\n`);
        response.end();
      }
    } finally {
      response.removeListener("close", abort);
    }
    return true;
  }
  return false;
}

export function attachVoiceWebSocket(server: Server, service: AsrService, auth: AuthOptions, connections?: DeviceConnections): () => void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PCM_FRAME_BYTES, perMessageDeflate: false });

  server.on("upgrade", (request, socket, head) => {
    // upgrade 时 Node 已摘掉 socket 上的 error 监听；先挂上，客户端 RST 不会变成未处理的 ECONNRESET 把进程带崩。
    socket.on("error", () => socket.destroy());
    let url: URL;
    try { url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); }
    catch { socket.destroy(); return; }
    if (url.pathname !== STREAM_PATH) {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }
    let verdict: AuthVerdict;
    try {
      verdict = authorize(request, url, auth);
    } catch {
      rejectUpgrade(socket, "500 Internal Server Error");
      return;
    }
    if (!verdict.ok) {
      rejectUpgrade(socket, `${verdict.status} ${verdict.status === 401 ? "Unauthorized" : "Forbidden"}`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      // 撤销设备时主动关掉这条连接；客户端重连会因 token 失效拿到 401。
      const unregister = connections?.add(verdict.deviceId, () => client.close(1008, "device revoked"));
      if (unregister) client.on("close", unregister);
      sockets.emit("connection", client, request);
    });
  });

  sockets.on("connection", (client) => {
    let session: AsrStream | null = null;
    let lastHypothesis = "";
    let queue = Promise.resolve();
    void service.createStream().then((created) => {
      // 会话建好前客户端已经断开：当时的 close 回调拿不到会话，这里补关，免得 X-ASR worker 里留下没人管的流。
      if (client.readyState !== client.OPEN) {
        void created.close().catch(() => undefined);
        return;
      }
      session = created;
      const status = service.status();
      client.send(JSON.stringify({ type: "ready", model: status.model, offlineRefinement: status.offlineRefinement }));
    }).catch((error: unknown) => {
      send(client, { type: "error", message: error instanceof Error ? error.message : "X-ASR 会话启动失败。" });
      client.close(1011, "X-ASR unavailable");
    });

    client.on("message", (data: RawData, isBinary: boolean) => {
      queue = queue.then(async () => {
        if (!session) throw new Error("X-ASR 会话尚未就绪。");
        if (!isBinary) {
          const control = JSON.parse(toBuffer(data).toString("utf8")) as { type?: string };
          if (control.type !== "finish") throw new Error("X-ASR 语音控制消息无效。");
          const update = await session.finish();
          if (update.text.trim()) send(client, { type: "final", text: update.text.trim() });
          send(client, { type: "finished" });
          lastHypothesis = "";
          return;
        }
        const pcm = toBuffer(data);
        if (pcm.length > MAX_PCM_FRAME_BYTES) throw new Error("音频帧太大，请更新 WhalePartner 后重试。");
        const update = await session.acceptPcm(pcm);
        if (update.final) {
          if (update.text.trim()) send(client, { type: "final", text: update.text.trim() });
          else send(client, { type: "segment-end" });
          lastHypothesis = "";
        } else if (update.text && update.text !== lastHypothesis) {
          lastHypothesis = update.text;
          send(client, { type: "partial", text: update.text });
        }
      }).catch((error: unknown) => {
        send(client, { type: "error", message: error instanceof Error ? error.message : "X-ASR 识别失败，请重试。" });
        client.close(1011, "X-ASR failure");
      });
    });

    client.on("close", () => {
      queue = queue.then(() => session?.close()).then(() => undefined).catch(() => undefined);
    });
    client.on("error", () => {
      queue = queue.then(() => session?.close()).then(() => undefined).catch(() => undefined);
    });
  });

  let closed = false;
  const closeConnections = () => {
    if (closed) return;
    closed = true;
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  };
  server.on("close", closeConnections);
  return closeConnections;
}

/** 拒绝升级：响应写完就销毁 socket，不留半开的连接。 */
function rejectUpgrade(socket: Duplex, status: string): void {
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function send(client: WebSocket, message: Record<string, unknown>): void {
  if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
}
