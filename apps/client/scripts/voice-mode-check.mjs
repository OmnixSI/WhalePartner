import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const clientDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const speechTexts = ["模拟语音第一轮", "模拟语音打断第二轮", "模拟语音第三轮"];
const chatRequests = [];
const ttsRequests = [];
const failures = [];
let segments = 0;
let socketCount = 0;
let closedSockets = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`✓ ${label}`);
  else {
    console.error(`✗ ${label}${detail ? `：${detail}` : ""}`);
    failures.push(label);
  }
}

const server = await createServer({
  configFile: resolve(clientDir, "vite.config.ts"),
  root: clientDir,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object", "Vite did not expose a local test port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("wp.character", "deepseek");
    localStorage.setItem("wp.onboarded", "1");
    let available = false;
    let inputContext;
    let inputGain;
    let inputStream;
    let microphoneRequests = 0;
    let stoppedTracks = 0;
    let audioPlaybackStarts = 0;
    let outputWaveformFrames = 0;
    let nonSilentOutputWaveformFrames = 0;
    const nativeBufferStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      audioPlaybackStarts += 1;
      return nativeBufferStart.apply(this, args);
    };
    const nativeAnalyserRead = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples) {
      nativeAnalyserRead.call(this, samples);
      outputWaveformFrames += 1;
      if (samples.some((sample) => Math.abs(sample) > 0.01)) nonSilentOutputWaveformFrames += 1;
    };
    Object.defineProperty(window, "__wpVoiceCheck", {
      configurable: false,
      value: {
        setAvailable(value) { available = value; },
        setTone(value) {
          if (inputGain && inputContext) inputGain.gain.setTargetAtTime(value ? 0.42 : 0, inputContext.currentTime, 0.02);
        },
        stats() {
          return {
            microphoneRequests,
            stoppedTracks,
            audioPlaybackStarts,
            outputWaveformFrames,
            nonSilentOutputWaveformFrames,
            endedTracks: inputStream?.getTracks().filter((track) => track.readyState === "ended").length ?? 0,
          };
        },
      },
    });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      microphoneRequests += 1;
      if (!available) throw new DOMException("No input device", "NotFoundError");
      if (!inputStream || inputStream.getTracks().every((track) => track.readyState === "ended")) {
        inputContext = new AudioContext({ latencyHint: "interactive" });
        const destination = inputContext.createMediaStreamDestination();
        const oscillator = inputContext.createOscillator();
        inputGain = inputContext.createGain();
        inputGain.gain.value = 0;
        oscillator.frequency.value = 440;
        oscillator.connect(inputGain).connect(destination);
        oscillator.start();
        inputStream = destination.stream;
        for (const track of inputStream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stoppedTracks += 1; stop(); };
        }
        await inputContext.resume();
      }
      if (constraints.audio.echoCancellation !== true || constraints.audio.noiseSuppression !== true) {
        throw new Error("Voice mode did not request echo cancellation and noise suppression.");
      }
      return inputStream;
    };
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/health") return json({ ok: true, provider: "mock" });
    if (path === "/api/chat/presence") return json({ ok: true });
    if (path === "/api/chat/sessions") return json({ sessions: [] });
    if (path === "/api/chat/history") return json({ messages: [] });
    if (path === "/api/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    if (path === "/api/voice/asr/status" || path === "/api/voice/asr/warm") {
      return json({ state: "ready", progress: 100, message: "", model: "X-ASR 480 ms (test)" });
    }
    if (path === "/api/voice/tts/status" || path === "/api/voice/tts/warm") {
      return json({ state: "ready", progress: 100, message: "", model: "Qwen3-TTS (test)" });
    }
    if (path === "/api/chat") {
      const input = request.postDataJSON();
      chatRequests.push(input);
      const turn = chatRequests.length;
      const events = [
        ["ack", { clientId: input.clientId, sessionId: "voice-check-session" }],
        ["emotion", { emotion: "happy" }],
        ["delta", { text: `第${turn}轮回答。` }],
        ["delta", { text: "再说一句。" }],
        ["done", { messageId: turn, sessionId: "voice-check-session", emotion: "happy" }],
      ];
      const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
      return route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
    }
    if (path === "/api/voice/tts/stream") {
      const input = request.postDataJSON();
      ttsRequests.push(input);
      const duration = 6;
      const sampleRate = 16_000;
      const samples = Buffer.alloc(Math.ceil(sampleRate * duration) * 2);
      for (let i = 0; i < samples.length / 2; i += 1) samples.writeInt16LE(Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 220) * 7_500), i * 2);
      const body = [
        { type: "meta", model: "Qwen3-TTS (test)", speaker: "serena" },
        { type: "audio", sampleRate, pcm16: samples.toString("base64") },
        { type: "done" },
      ].map((message) => JSON.stringify(message)).join("\n") + "\n";
      return route.fulfill({ status: 200, contentType: "application/x-ndjson; charset=utf-8", body });
    }
    return json({ ok: true });
  });

  await page.routeWebSocket("**/api/voice/asr/stream", (socket) => {
    socketCount += 1;
    let closeForwarded = false;
    socket.onClose((code, reason) => {
      if (closeForwarded) return;
      closeForwarded = true;
      closedSockets += 1;
      void socket.close({ code: code ?? 1000, reason: reason ?? "" });
    });
    socket.send(JSON.stringify({ type: "ready", model: "X-ASR 480 ms (test)" }));
    let voicedFrames = 0;
    let quietFrames = 0;
    socket.onMessage((message) => {
      if (typeof message === "string") return;
      const pcm = Buffer.isBuffer(message) ? message : Buffer.from(message);
      if (pcm.length < 2 || pcm.length % 2 !== 0) return;
      let sum = 0;
      for (let offset = 0; offset < pcm.length; offset += 2) {
        const sample = pcm.readInt16LE(offset) / 32_768;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / (pcm.length / 2));
      if (rms >= 0.018) {
        voicedFrames += 1;
        quietFrames = 0;
        if (voicedFrames === 1) socket.send(JSON.stringify({ type: "partial", text: "模拟识别中" }));
      } else if (voicedFrames > 0) {
        quietFrames += 1;
        if (quietFrames >= 2) {
          const text = speechTexts[segments] ?? `模拟语音第${segments + 1}轮`;
          segments += 1;
          socket.send(JSON.stringify({ type: "final", text }));
          voicedFrames = 0;
          quietFrames = 0;
        }
      }
    });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const enterVoice = page.getByRole("button", { name: "进入连续语音模式" });
  await enterVoice.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.body.innerText.includes("发送"));

  await enterVoice.click();
  const alert = page.locator(".composer__voice-status[role='alert']");
  await alert.waitFor({ state: "visible" });
  check("无麦克风时显示可恢复错误", (await alert.innerText()).includes("没有检测到可用麦克风"));
  await page.evaluate(() => window.__wpVoiceCheck.setAvailable(true));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const status = page.locator(".composer__voice-status");
  await status.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".composer__voice-status")?.textContent?.includes("语音模式已就绪"), null, { timeout: 15_000 });
  check("重试后进入聆听状态", (await status.innerText()).includes("语音模式已就绪"));
  check("开启麦克风时启用回声消除和降噪", (await page.evaluate(() => window.__wpVoiceCheck.stats().microphoneRequests)) === 2);

  async function speak() {
    await page.evaluate(() => window.__wpVoiceCheck.setTone(true));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__wpVoiceCheck.setTone(false));
    await page.waitForTimeout(350);
  }

  await speak();
  await page.waitForFunction(() => document.body.innerText.includes("第1轮回答。"), null, { timeout: 10_000 });
  check("第一轮语音最终稿只进入共享聊天一次", chatRequests.length === 1 && chatRequests[0]?.message === speechTexts[0]);
  await page.waitForFunction(() => document.querySelector(".composer__voice-status")?.textContent?.includes("大肥鱼正在回答"), null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().audioPlaybackStarts >= 2, null, { timeout: 10_000 });
  check("多句回复按句分段生成并排队播放", ttsRequests.slice(0, 2).map((input) => input.text).join("|") === "第1轮回答。|再说一句。");
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().nonSilentOutputWaveformFrames > 0, null, { timeout: 5_000 });
  check("TTS 播放产生非静音波形供 Live2D 嘴型驱动", (await page.evaluate(() => window.__wpVoiceCheck.stats().outputWaveformFrames)) > 0);

  await page.evaluate(() => window.__wpVoiceCheck.setTone(true));
  await page.waitForFunction(() => document.querySelector(".composer__voice-status")?.textContent?.includes("已停止她当前的回答"), null, { timeout: 5_000 });
  check("说话时打断正在播放的 TTS", (await status.innerText()).includes("已停止她当前的回答"));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__wpVoiceCheck.setTone(false));
  await page.waitForFunction(() => document.body.innerText.includes("第2轮回答。"), null, { timeout: 10_000 });
  check("打断后识别文本开始第二轮对话", chatRequests.length === 2 && chatRequests[1]?.message === speechTexts[1]);
  check("情绪标签传入 TTS 合成", ttsRequests.length >= 2 && ttsRequests.every((input) => input.emotion === "happy"));

  await page.waitForFunction(
    (heard) => document.querySelector(".composer__voice-status")?.textContent?.includes(`听到了：「${heard}」`),
    speechTexts[1],
    { timeout: 10_000 },
  );
  await speak();
  await page.waitForFunction(() => document.body.innerText.includes("第3轮回答。"), null, { timeout: 10_000 });
  check("语音模式连续完成三轮识别与回复", chatRequests.length === 3 && chatRequests[2]?.message === speechTexts[2]);
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().audioPlaybackStarts >= 5, null, { timeout: 10_000 });
  const ttsCountBeforeSwitch = ttsRequests.length;
  await page.evaluate(async () => {
    const { setCharacter } = await import("/src/characters.ts");
    setCharacter("claude");
  });
  await page.waitForFunction(() => document.querySelector(".mbar__name")?.textContent === "小克");
  await page.getByRole("button", { name: "进入连续语音模式" }).waitFor({ state: "visible" });
  check(
    "切换人格时结束语音会话、停止播放并释放麦克风",
    (await page.evaluate(() => window.__wpVoiceCheck.stats().stoppedTracks)) === 1 && ttsRequests.length === ttsCountBeforeSwitch,
  );
  await page.evaluate(async () => {
    const { setCharacter } = await import("/src/characters.ts");
    setCharacter("deepseek");
  });
  await page.waitForFunction(() => document.querySelector(".mbar__name")?.textContent === "大肥鱼");
  await page.getByRole("button", { name: "进入连续语音模式" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("语音模式已就绪"), null, { timeout: 15_000 });
  check("切回大肥鱼后可重新进入语音模式", (await page.evaluate(() => window.__wpVoiceCheck.stats().microphoneRequests)) === 3);

  await page.getByRole("button", { name: "结束语音模式" }).click();
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().endedTracks === 1);
  for (let attempt = 0; attempt < 60 && closedSockets < socketCount; attempt += 1) await page.waitForTimeout(50);
  check("退出时停止麦克风轨道", (await page.evaluate(() => window.__wpVoiceCheck.stats().stoppedTracks)) === 2);
  check("退出时关闭 ASR WebSocket", socketCount === 2 && closedSockets === 2, `${closedSockets}/${socketCount}`);
  check("页面没有未处理异常", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await page.close();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  if (browser) await browser.close();
  await server.close();
}

console.log(`\n${failures.length ? `失败 ${failures.length} 项` : "全部通过"}`);
process.exitCode = failures.length ? 1 : 0;
