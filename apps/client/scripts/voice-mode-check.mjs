import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const clientDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const speechTexts = ["模拟语音第一轮", "模拟语音打断第二轮", "模拟语音第三轮"];
const ttsRequests = [];
const failures = [];
let segments = 0;
let socketCount = 0;
let closedSockets = 0;
let asrPcmFramesReceived = 0;

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
    let audioPlaybackStops = 0;
    let pcmPlaybackPushes = 0;
    let pcmPlaybackStops = 0;
    let pcmPlaybackFinishes = 0;
    let pcmPlaybackSegmentDone = 0;
    let playbackWorklets = 0;
    let ttsStreamCount = 0;
    let ttsAudioChunksReceived = 0;
    let ttsAbortRequests = 0;
    let chatAbortRequests = 0;
    let ttsStartedBeforeChatDone = 0;
    let chatDone = true;
    let slowTurnId = null;
    const chatRequests = [];
    let emotionEvents = 0;
    const audioStartChunkCounts = [];
    const playbackScheduleGaps = [];
    let previousScheduledEnd = null;
    let outputWaveformFrames = 0;
    let nonSilentOutputWaveformFrames = 0;
    const voiceDiagnostics = [];
    window.addEventListener("whalepartner:voice-diagnostic", (event) => voiceDiagnostics.push(event.detail));
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.href);
      if (requestUrl.pathname === "/api/chat") {
        const request = JSON.parse(args[1]?.body ?? "{}" );
        chatRequests.push(request);
        chatDone = false;
        const turn = chatRequests.length;
        if (turn === 2) slowTurnId = request.clientId;
        const events = [
          ["ack", { clientId: request.clientId, sessionId: "voice-check-session" }],
          ["emotion", { emotion: "happy" }],
          ["delta", { text: `第${turn}轮回答内容足够长，而且已经形成完整意思，可以先开始语音合成。` }],
          ["delta", { text: "再说一句，也保持自然语气。" }],
          ["done", { messageId: turn, sessionId: "voice-check-session", emotion: "happy" }],
        ];
        const encoder = new TextEncoder();
        let index = 0;
        let timer = 0;
        let streamController;
        const body = new ReadableStream({
          start(controller) {
            streamController = controller;
            const sendNext = () => {
              if (index >= events.length) {
                controller.close();
                return;
              }
              const [name, data] = events[index++];
              if (name === "emotion") emotionEvents += 1;
              if (name === "done") chatDone = true;
              controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
              if (index < events.length) timer = window.setTimeout(sendNext, name === "delta" ? (turn === 2 ? 15_000 : 1_400) : 15);
              else controller.close();
            };
            sendNext();
          },
          cancel() { window.clearTimeout(timer); },
        });
        args[1]?.signal?.addEventListener("abort", () => {
          chatAbortRequests += 1;
          window.clearTimeout(timer);
          try { streamController?.error(new DOMException("Aborted", "AbortError")); } catch { /* The stream already ended. */ }
        }, { once: true });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
      }
      const ttsRequest = requestUrl.pathname === "/api/voice/tts/stream" ? JSON.parse(args[1]?.body ?? "{}" ) : null;
      if (ttsRequest) args[1]?.signal?.addEventListener("abort", () => { ttsAbortRequests += 1; }, { once: true });
      const response = await nativeFetch(...args);
      if (requestUrl.pathname !== "/api/voice/tts/stream") return response;
      if (!chatDone) ttsStartedBeforeChatDone += 1;
      ttsStreamCount += 1;
      const lines = (await response.text()).trim().split("\n");
      const encoder = new TextEncoder();
      let index = 0;
      let audioIndex = 0;
      let timer = 0;
      let streamController;
      const body = new ReadableStream({
        start(controller) {
          streamController = controller;
          const sendNext = () => {
            if (index >= lines.length) {
              controller.close();
              return;
            }
            const line = lines[index++];
            const message = JSON.parse(line);
            if (message.type === "audio") ttsAudioChunksReceived += 1;
            controller.enqueue(encoder.encode(`${line}\n`));
            const chunkNumber = message.type === "audio" ? audioIndex++ : -1;
            const delay = message.type === "audio"
              ? ttsRequest.turnId === slowTurnId && chunkNumber === 0
                ? 15_000
              : chunkNumber === 1 ? 80 : 40
              : 0;
            timer = window.setTimeout(sendNext, delay);
          };
          sendNext();
        },
        cancel() { window.clearTimeout(timer); },
      });
      args[1]?.signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        try { streamController?.error(new DOMException("Aborted", "AbortError")); } catch { /* The stream already ended. */ }
      }, { once: true });
      return new Response(body, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "application/x-ndjson" },
      });
    };
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
      construct(target, args, newTarget) {
        if (args[1] === "whale-pcm-playback") playbackWorklets += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
    const nativePortPostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, transfer) {
      if (message?.type === "push") {
        pcmPlaybackPushes += 1;
        audioStartChunkCounts.push(ttsAudioChunksReceived);
      }
      if (message?.type === "stop") pcmPlaybackStops += 1;
      if (message?.type === "finish") pcmPlaybackFinishes += 1;
      if (message?.type === "segment-done") pcmPlaybackSegmentDone += 1;
      return nativePortPostMessage.call(this, message, transfer);
    };
    const nativeBufferStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      audioPlaybackStarts += 1;
      return nativeBufferStart.apply(this, args);
    };
    const nativeBufferStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      audioPlaybackStops += 1;
      previousScheduledEnd = null;
      return nativeBufferStop.apply(this, args);
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
            audioPlaybackStops,
      pcmPlaybackPushes,
      pcmPlaybackStops,
      pcmPlaybackFinishes,
      pcmPlaybackSegmentDone,
      playbackWorklets,
            ttsStreamCount,
            ttsAudioChunksReceived,
            audioStartChunkCounts,
            playbackScheduleGaps,
            outputWaveformFrames,
            nonSilentOutputWaveformFrames,
            voiceDiagnostics: voiceDiagnostics.filter((event) => event.event === "client-voice-stop" || event.event === "worklet-buffer" || event.event === "worklet-started" || event.event === "worklet-drained" || event.event === "worklet-stopped" || event.event === "worklet-underrun-start" || event.event === "worklet-underrun-end" || event.event === "voice-interruption"),
            ttsStartedBeforeChatDone,
            ttsAbortRequests,
            chatAbortRequests,
            chatDone,
            chatRequests,
            emotionEvents,
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
      if (constraints.audio.echoCancellation !== true || constraints.audio.noiseSuppression !== true || constraints.audio.autoGainControl !== false) {
        throw new Error("Voice mode must enable echo cancellation and noise suppression while disabling automatic gain control.");
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
      return json({ state: "ready", progress: 100, message: "", model: "X-ASR 480 ms (test)", offlineRefinement: "ready" });
    }
    if (path === "/api/voice/tts/status" || path === "/api/voice/tts/warm") {
      return json({ state: "ready", progress: 100, message: "", model: "Qwen3-TTS (test)" });
    }
    if (path === "/api/voice/tts/stream") {
      const input = request.postDataJSON();
      ttsRequests.push(input);
      const duration = 0.48;
      const sampleRate = 24_000;
      const messages = [{ type: "meta", model: "Qwen3-TTS (test)", speaker: "Serena", turnId: input.turnId, segmentIndex: input.segmentIndex }];
      let sampleOffset = 0;
      for (let chunk = 0; chunk < 6; chunk += 1) {
        const samples = Buffer.alloc(Math.ceil(sampleRate * duration) * 2);
        for (let i = 0; i < samples.length / 2; i += 1) {
          samples.writeInt16LE(Math.round(Math.sin(((sampleOffset + i) / sampleRate) * 2 * Math.PI * 220) * 7_500), i * 2);
        }
        sampleOffset += samples.length / 2;
        messages.push({ type: "audio", sampleRate, pcm16: samples.toString("base64"), turnId: input.turnId, segmentIndex: input.segmentIndex, chunkIndex: chunk });
      }
      messages.push({ type: "done", turnId: input.turnId, segmentIndex: input.segmentIndex });
      const body = [
        ...messages,
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
    socket.send(JSON.stringify({ type: "ready", model: "X-ASR 480 ms (test)", offlineRefinement: "ready" }));
    let voicedFrames = 0;
    let quietFrames = 0;
    socket.onMessage((message) => {
      if (typeof message === "string") {
        const control = JSON.parse(message);
        if (control.type === "finish") {
          if (voicedFrames > 0) {
            const text = speechTexts[segments] ?? `模拟语音第${segments + 1}轮`;
            segments += 1;
            socket.send(JSON.stringify({ type: "final", text }));
            voicedFrames = 0;
            quietFrames = 0;
          }
          socket.send(JSON.stringify({ type: "finished" }));
        }
        return;
      }
      asrPcmFramesReceived += 1;
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
  const enterVoice = page.getByRole("button", { name: "开始语音录音" });
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
  await page.getByRole("button", { name: "结束录音并发送" }).waitFor({ state: "visible", timeout: 15_000 });
  check("重试后开始录音，停顿不会自动发送", (await status.innerText()).includes("停顿不会发送"));
  check("开启麦克风时启用回声消除和降噪并关闭 AGC", (await page.evaluate(() => window.__wpVoiceCheck.stats().microphoneRequests)) === 2);

  async function speak() {
    await page.evaluate(() => window.__wpVoiceCheck.setTone(true));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__wpVoiceCheck.setTone(false));
    await page.waitForTimeout(350);
  }

  async function finishRecording() {
    await page.getByRole("button", { name: "结束录音并发送" }).click();
  }

  await speak();
  await finishRecording();
  await page.waitForFunction(() => document.body.innerText.includes("第1轮回答内容足够长"), null, { timeout: 10_000 });
  const firstTurn = await page.evaluate(() => window.__wpVoiceCheck.stats().chatRequests[0]);
  check("第一轮语音最终稿只进入共享聊天一次", firstTurn?.message === speechTexts[0]);
  await page.waitForFunction(() => document.querySelector(".composer__voice-status")?.textContent?.includes("大肥鱼正在回答"), null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().pcmPlaybackPushes >= 4, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().ttsStreamCount >= 1, null, { timeout: 10_000 });
  const asrFramesAtPlayback = asrPcmFramesReceived;
  await page.waitForTimeout(500);
  check(
    "按下发送后停止采集并向 X-ASR 结束本轮",
    asrPcmFramesReceived === asrFramesAtPlayback,
    `${asrFramesAtPlayback} -> ${asrPcmFramesReceived}`,
  );
  check(
    "第一句在 LLM 完成整轮回答前送入 TTS，并使用独立 turn ID",
    (await page.evaluate(() => window.__wpVoiceCheck.stats().ttsStartedBeforeChatDone)) > 0
      && ttsRequests[0]?.turnId === firstTurn?.clientId
      && ttsRequests[0]?.text === "第1轮回答内容足够长，而且已经形成完整意思，可以先开始语音合成。",
    JSON.stringify({ request: ttsRequests[0], turnId: firstTurn?.clientId }),
  );
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().ttsStreamCount >= 2, null, { timeout: 10_000 });
  check(
    "按句界排队合成两句话，LLM 的结构化情绪同步控制 TTS 表达与角色表情",
    ttsRequests[1]?.text === "再说一句，也保持自然语气。"
      && ttsRequests.every((input) => input.emotion === "happy" && input.characterId === "deepseek")
      && (await page.evaluate(() => window.__wpVoiceCheck.stats().emotionEvents)) > 0,
    JSON.stringify(ttsRequests.slice(0, 2)),
  );
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().pcmPlaybackFinishes >= 1, null, { timeout: 10_000 });
  check(
    "单句完成不结束整轮播放，整轮只发送一次 finish",
    (await page.evaluate(() => window.__wpVoiceCheck.stats().pcmPlaybackSegmentDone)) >= 2
      && (await page.evaluate(() => window.__wpVoiceCheck.stats().pcmPlaybackFinishes)) === 1,
    JSON.stringify(await page.evaluate(() => window.__wpVoiceCheck.stats())),
  );
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().pcmPlaybackPushes >= 8, null, { timeout: 10_000 });
  const playbackStats = await page.evaluate(() => window.__wpVoiceCheck.stats());
  console.log(JSON.stringify({ playback: playbackStats }));
  check(
    "流式 PCM 块进入同一个 AudioWorklet 连续播放队列，不逐块创建播放源",
    playbackStats.playbackWorklets === 1
      && playbackStats.pcmPlaybackPushes >= 8
      && playbackStats.audioPlaybackStarts === 0,
    JSON.stringify({ worklets: playbackStats.playbackWorklets, pcmChunks: playbackStats.pcmPlaybackPushes, bufferSources: playbackStats.audioPlaybackStarts }),
  );
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().nonSilentOutputWaveformFrames > 0, null, { timeout: 5_000 });
  check("TTS 播放产生非静音波形供 Live2D 嘴型驱动", (await page.evaluate(() => window.__wpVoiceCheck.stats().outputWaveformFrames)) > 0);

  const beforePlaybackInterrupt = await page.evaluate(() => window.__wpVoiceCheck.stats());
  const asrFramesBeforeInterrupt = asrPcmFramesReceived;
  const lastPlaybackState = [...beforePlaybackInterrupt.voiceDiagnostics].reverse().find((event) => event.event === "worklet-started" || event.event === "worklet-drained" || event.event === "worklet-stopped");
  check("播放中断言发生在 AudioWorklet 活跃期间", lastPlaybackState?.event === "worklet-started", lastPlaybackState?.event ?? "没有播放状态事件");
  await page.getByRole("button", { name: "开始语音录音" }).click();
  await page.getByRole("button", { name: "结束录音并发送" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.evaluate(() => window.__wpVoiceCheck.setTone(true));
  const interruptObserved = await page.waitForFunction(() => {
    const diagnostics = window.__wpVoiceCheck.stats().voiceDiagnostics;
    const voiceStopped = diagnostics.some((event) => event.event === "client-voice-stop" && event.reason === "voice-button-started-recording");
    const workletStopped = diagnostics.some((event) => event.event === "worklet-stopped" && event.reason === "voice-button-started-recording");
    return voiceStopped && workletStopped;
  }, null, { timeout: 5_000 }).then(() => true, () => false);
  const afterPlaybackInterrupt = await page.evaluate(() => window.__wpVoiceCheck.stats());
  if (!interruptObserved) {
    console.error(JSON.stringify({ reason: "mic button did not interrupt playback", pcmFrames: [asrFramesBeforeInterrupt, asrPcmFramesReceived], message: await status.innerText(), diagnostics: afterPlaybackInterrupt.voiceDiagnostics.slice(-8) }));
    throw new Error("播放期间按下麦克风未打断当前回答。");
  }
  check(
    "点击麦克风立即停止正在播放的 TTS",
    afterPlaybackInterrupt.pcmPlaybackStops > beforePlaybackInterrupt.pcmPlaybackStops
      && afterPlaybackInterrupt.voiceDiagnostics.some((event) => event.event === "voice-interruption" && event.reason === "voice-button-started-recording" && event.assistantSpeaking),
    JSON.stringify({ stops: [beforePlaybackInterrupt.pcmPlaybackStops, afterPlaybackInterrupt.pcmPlaybackStops], diagnostics: afterPlaybackInterrupt.voiceDiagnostics.slice(-5) }),
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__wpVoiceCheck.setTone(false));
  await speak();
  await finishRecording();
  await page.waitForFunction(() => document.body.innerText.includes("第2轮回答内容足够长"), null, { timeout: 10_000 });
  const chatAfterInterrupt = await page.evaluate(() => window.__wpVoiceCheck.stats().chatRequests);
  check("打断后识别文本开始第二轮对话", chatAfterInterrupt.length === 2 && chatAfterInterrupt[1]?.message === speechTexts[1]);
  check(
    "每轮 TTS 携带对应 turn ID，LLM 情绪事件单独驱动角色表情",
    ttsRequests.filter((input) => input.turnId === chatAfterInterrupt[1]?.clientId).length >= 1
      && ttsRequests.every((input) => input.emotion === "happy" && input.characterId === "deepseek")
      && (await page.evaluate(() => window.__wpVoiceCheck.stats().emotionEvents)) >= 2,
  );

  await page.waitForFunction(() => {
    const stats = window.__wpVoiceCheck.stats();
    return stats.ttsStreamCount >= 3 && !stats.chatDone;
  }, null, { timeout: 10_000 });
  const beforeSynthesisInterrupt = await page.evaluate(() => window.__wpVoiceCheck.stats());
  check("用户开口时第二轮仍有未完成的聊天与 TTS 请求", beforeSynthesisInterrupt.chatRequests.length === 2);
  await page.getByRole("button", { name: "开始语音录音" }).click();
  await page.getByRole("button", { name: "结束录音并发送" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.evaluate(() => window.__wpVoiceCheck.setTone(true));
  const afterSynthesisInterrupt = await page.evaluate(() => window.__wpVoiceCheck.stats());
  check(
    "打断同时取消当前 LLM 与 TTS 请求，并废弃旧 turn 队列",
    afterSynthesisInterrupt.chatAbortRequests > beforeSynthesisInterrupt.chatAbortRequests
      && afterSynthesisInterrupt.ttsAbortRequests > beforeSynthesisInterrupt.ttsAbortRequests,
  );
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__wpVoiceCheck.setTone(false));
  await speak();
  await finishRecording();
  await page.waitForFunction(() => document.body.innerText.includes("第3轮回答内容足够长"), null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().chatDone, null, { timeout: 5_000 });
  const allChatRequests = await page.evaluate(() => window.__wpVoiceCheck.stats().chatRequests);
  check("语音模式连续完成三轮识别与回复", allChatRequests.length === 3 && allChatRequests[2]?.message === speechTexts[2]);
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().ttsStreamCount >= 4, null, { timeout: 5_000 });
  const ttsCountBeforeSwitch = ttsRequests.length;
  await page.evaluate(async () => {
    const { setCharacter } = await import("/src/characters.ts");
    setCharacter("claude");
  });
  await page.waitForFunction(() => document.querySelector(".mbar__name")?.textContent === "小克");
  await page.getByRole("button", { name: "开始语音录音" }).waitFor({ state: "visible" });
  check(
    "切换人格时结束语音会话并停止播放",
    (await page.evaluate(() => window.__wpVoiceCheck.stats().stoppedTracks)) === 3 && ttsRequests.length === ttsCountBeforeSwitch,
  );
  await page.evaluate(async () => {
    const { setCharacter } = await import("/src/characters.ts");
    setCharacter("deepseek");
  });
  await page.waitForFunction(() => document.querySelector(".mbar__name")?.textContent === "大肥鱼");
  await page.getByRole("button", { name: "开始语音录音" }).click();
  await page.getByRole("button", { name: "结束录音并发送" }).waitFor({ state: "visible", timeout: 15_000 });
  check("切回大肥鱼后可重新开始录音", (await page.evaluate(() => window.__wpVoiceCheck.stats().microphoneRequests)) === 5);

  await page.getByRole("button", { name: "结束语音模式" }).click();
  await page.waitForFunction(() => window.__wpVoiceCheck.stats().endedTracks === 1);
  for (let attempt = 0; attempt < 60 && closedSockets < socketCount; attempt += 1) await page.waitForTimeout(50);
  check("退出时停止麦克风轨道", (await page.evaluate(() => window.__wpVoiceCheck.stats().stoppedTracks)) === 4);
  check("退出时关闭 ASR WebSocket", socketCount === 3 && closedSockets === 3, `${closedSockets}/${socketCount}`);
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
