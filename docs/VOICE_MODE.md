# 连续语音

连续语音复用共享聊天和人格上下文。浏览器采集麦克风 PCM16 单声道音频并以 16 kHz 帧发送给本机 API；原始音频不写入 SQLite 或磁盘。每轮识别只把 X-ASR 最终稿提交到正常聊天接口，中间识别稿仅显示在语音状态中。

## 识别、聊天与合成

- ASR 使用 sherpa-onnx X-ASR 中文/英文 480 ms 流式模型，并按 InterviewHacker 的两遍流程对整句精修。流式与离线模型使用不同的编码器和解码器权重：流式模型负责实时 partial，离线模型负责整句重识别；两套缺一不可。WhalePartner 自己的 RMS VAD 在约 700 ms 静音后收句；流式模型关闭内部端点检测，收句时补 400 ms 静音并冲刷剩余识别状态。随后同一 worker 用配套离线 X-ASR 模型重识别完整 PCM 句段，并补 300 ms 尾音；非空精修稿作为最终稿发送，实时流式稿仍用于中间预览。两套权重都只从 WhalePartner 自己的应用数据目录加载。该 480 ms 设置属于语音识别，不控制 TTS。
- 聊天继续使用当前角色和现有服务端模型配置。每轮使用聊天 `clientId` 作为 turn ID。VAD 确认用户开口后，立即停止正在播放的 PCM、取消当前聊天和 TTS 请求、清空旧轮次队列；后续到达的音频只接受当前 turn ID。
- TTS 使用 `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`，由 WhalePartner 独立 Python 环境和本地持久 worker 在 Apple Silicon 上运行，预置 Serena 音色。API 进程启动监听后即异步启动 worker、加载模型并执行短音频预热；聊天页面和语音模式无需再次加载模型。
- LLM 回复按完整句子边界进入 TTS 队列，不等待整轮回复。过短的句子会与后一句合并；长句会在逗号等自然分句标点处拆分。TTS 按句流式生成 PCM，浏览器先短暂预缓冲，再通过单一 AudioWorklet 播放队列连续输出，不为每个 PCM 块单独起播。用户打断时清空播放队列并取消当前合成。
- X-ASR 与 TTS 都在 API 启动监听后异步加载并预热；进入连续语音时只等待启动中的模型变为就绪，不再启动首次加载。
- 0.6B 模型使用固定 Serena 音色，不接受自然语言情绪指令。LLM 的结构化情绪事件直接控制 Live2D 表情，音频分析器读取实际播放 PCM 的 RMS 振幅驱动嘴型。语音音色本身不会随情绪标签切换。

## 数据和运行环境

默认数据目录为 `~/Library/Application Support/com.omnixsi.whalepartner/`：

- X-ASR 权重：`models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05/`
- X-ASR 离线精修权重：`models/sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03/`
- Qwen TTS 模型缓存：`models/tts/hf/`
- sherpa-onnx Python 环境：`runtimes/asr-sherpa/`
- MLX-Audio Python 环境：`runtimes/tts-mlx/`

权重和 Python 环境不提交 Git。ASR 首次启动会在 WhalePartner 用户数据目录中下载流式和离线精修模型并准备独立运行环境；TTS 首次启动也会下载模型并准备独立环境。模型缓存后，API 进程在应用启动阶段载入模型并预热。TTS 目前只在 Apple Silicon macOS 上启用；语音播放只在大肥鱼人格和显式开启连续语音模式时自动触发。

## 本机实测

测试设备为 Apple M4、16 GB 内存。X-ASR 使用 WhalePartner 用户数据目录中的两套本机 INT8 权重，以 Python 3.12.7 / sherpa-onnx 1.13.8 加载；将本机生成的 4.96 秒中文语音按 100 ms 帧输入后，流式稿连续出现，两个自然句末各在 VAD 静音段后产出离线精修 final。测试不录制麦克风，也不调用聊天模型。TTS 使用 WhalePartner 独立 MLX-Audio 0.6.4 / Python 3.12.7 环境及本机模型缓存生成中文样本，不录制麦克风，也不调用付费聊天模型。0.6B 8-bit 模型预热生成约 1.48 秒；0.96 秒块长的首块约 0.88 秒到达，之后块间隔约 0.80–0.82 秒。AudioWorklet 收到两块、缓存 1.92 秒后开始连续播放，样本首声约在句子提交后 1.70 秒开始。对照 0.48 秒块长，首块约 0.89 秒到达但块数从 7 增至 16，未缩短首块时间，因此保留 0.96 秒块长并用连续队列播放。语音试听文件位于 WhalePartner 用户数据目录：`review-samples/qwen3-tts-06b-8bit-serena-sample.wav`。

运行 `pnpm --dir apps/client run voice-mode:check` 会启动隔离的 Vite 页面并模拟 ASR、聊天和 TTS。检查多轮识别、句界提前合成、turn ID、句间连续排队、实际 PCM 嘴型振幅、用户开口打断和麦克风释放；不调用模型、不录制真实麦克风，也不修改用户数据库。本机模型样音和打包 sidecar 单独进行实测。默认使用 Playwright 管理的 Chromium；本机已有 Chrome 时可用 `CHROME_PATH` 指定其可执行文件。

## 许可和接口

Qwen3-TTS 模型及 MLX 权重卡标注 Apache-2.0；[MLX-Audio](https://github.com/Blaizzy/mlx-audio) 代码采用 MIT。当前 0.6B CustomVoice 模型的 `instruct` 控制不受支持，因此情绪只映射到角色表情，不传给 TTS。WhalePartner 的 X-ASR 词表和许可说明位于 `apps/api/src/voice/assets/`；上游模型见 [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR)。所有模型权重留在用户数据目录。

语音 API 见 [`API.md`](API.md)：`/api/voice/asr/*` 提供 X-ASR 状态和 WebSocket 流；`/api/voice/tts/*` 提供 TTS 状态、准备和带 turn ID 的 NDJSON 音频流。
