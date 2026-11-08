# 连续语音

连续语音复用共享聊天和角色上下文。客户端采集 16 kHz 单声道 PCM16 并发给本机 API；音频只在内存中处理，不写入数据库或文件。识别最终稿进入正常聊天接口，中间识别稿只显示在语音状态中。

## 识别、聊天与合成

- ASR 使用 sherpa-onnx X-ASR 中文/英文 480 ms 流式模型，并对整句做离线精修。流式与离线模型使用不同的编码器和解码器权重：流式模型负责实时 partial，离线模型负责整句重识别。WhalePartner 自己的 RMS VAD 在约 700 ms 静音后收句；流式模型关闭内部端点检测，收句时补 400 ms 静音并冲刷剩余识别状态。随后同一 worker 用离线 X-ASR 模型重识别完整 PCM 句段并补 300 ms 尾音，非空精修稿作为最终稿。两套模型权重都从 WhalePartner 自己的应用数据目录加载；480 ms 是 ASR 块长，不控制 TTS。
- TTS 使用 [`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit)，由 WhalePartner 独立 MLX-Audio Python 环境和本地常驻 worker 在 Apple Silicon 上运行，预置 Serena 音色。API 启动时异步加载模型并预热；首次启动会把权重下载到 WhalePartner 自己的应用数据目录。
- 大肥鱼绑定 Serena 音色，并将稳定的角色音色描述与 LLM 发出的结构化情绪标签作为 Qwen3-TTS 指令。情绪标签同时驱动 Live2D 表情；Live2D 嘴型由实际播放 PCM 的 RMS 振幅驱动。
- 回复按自然句界进入 TTS，不等待 LLM 完成整轮回答。过短的句子会和下一句合并，长句在逗号等自然分句标点处拆分。当前最小独立分段长度为 20 个字符。首句立即提交；首句合成期间已排队的后续句子，在角色与情绪一致且合计不超过 180 个字符时合为一个请求，避免每句重复启动模型并保留标点语气。模型流式块长为 2 秒，与 [MLX Audio 的 Qwen3-TTS 默认间隔](https://github.com/Blaizzy/mlx-audio/blob/main/docs/guides/streaming.md)一致；客户端按实测采用 1.44 秒播放预缓冲。
- 每个 TTS 请求以 `segment-done` 标记单句完成；只有 LLM 已结束且本轮 TTS 队列排空后，客户端才向 AudioWorklet 发一次 `finish`。Worklet 在同一 turn 中保持播放状态，队列暂时耗尽时记录 underrun，不重置后再次预缓冲。日志包含 turn/segment/chunk 标识、TTS 首块和分块时间、缓冲量、欠载次数与时长、句界空白和打断原因。
- 播放队列直接拼接 PCM，不在每个流式块后插入静音。对实测 WAV 的句界采样检查没有发现不连续尖峰，因此不额外做淡入淡出。
- 麦克风请求启用系统回声消除和降噪，关闭自动增益控制（AGC）。助手播放期间用 0.03 RMS、连续 180 ms 的门槛识别用户打断；普通聆听期间使用 0.018 RMS、连续 120 ms。实测发现开启 AGC 时扬声器回声会误触发，关闭后回声低于播放期门槛。
- 每轮使用聊天 `clientId` 作为 turn ID。用户打断会立即停止当前播放、取消聊天与 TTS 请求并清空旧队列；AudioWorklet 拒绝不匹配的 turn ID。角色表情由结构化情绪事件控制，嘴型由播放 PCM 的 RMS 控制。

## 数据目录与运行环境

默认数据目录为 `~/Library/Application Support/com.omnixsi.whalepartner/`：

- X-ASR 流式权重：`models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05/`
- X-ASR 离线精修权重：`models/sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03/`
- Qwen3-TTS 权重缓存：`models/tts/hf/`
- sherpa-onnx Python 环境：`runtimes/asr-sherpa/`
- MLX-Audio Python 环境：`runtimes/tts-mlx/`

权重和 Python 环境不提交 Git。ASR、TTS 与已启用的本地记忆向量模型都在 API 启动后异步加载并预热，模型状态可从本机 API 观察；进入功能时只等待启动中的模型就绪。TTS 仅在 Apple Silicon macOS 上启用；语音播放仅在大肥鱼人格和用户主动开启连续语音模式时启用。

## 本机验证

测试设备为 Apple M4、16 GB 内存，MLX-Audio 0.6.4 / Python 3.12.7。X-ASR 使用本机两套 INT8 权重和 sherpa-onnx 1.13.8；合成的 4.96 秒中文音频按 100 ms 帧输入后，流式稿连续出现，两个自然句末均由 VAD 收句并产生离线精修稿。2 秒配置的桌面包启动后，API 状态显示 X-ASR 流式与离线精修、Qwen3-TTS 和本地记忆均为 ready。长语音测量期间，TTS worker `vmmap` 当前物理占用 3.1 GiB、进程峰值 6.2 GiB。

真实 TTS 测试使用本机 Qwen3-TTS 1.7B 8-bit Serena，经本机 API 和 Chromium AudioWorklet 播放。测试捕获的是 Worklet 实际输出的 PCM；首声时间从发起首句请求计到 Worklet 启播，RTF 为整段请求生成耗时除以 PCM 时长。整轮协议只启动/排空一次 Worklet；对照逐句发送 `finish` 的协议，三句样本句间空白由 5.29 秒降至 3.86 秒，首声由 4.70 秒降至 3.35 秒。合并后续两句后，TTS 请求从 3 次降到 2 次，首声 2.30 秒、句间空白 0.89 秒、RTF 1.36，欠载静音 7.86 秒。

60 秒以上中文长测中，逐句请求生成 74.96 秒 PCM，用时 132.49 秒，RTF 1.77；Worklet 启动/排空各 1 次，欠载静音 56.50 秒。采用产品实际策略（首句立即合成，余句按不超过 180 字合并）后，10 句成为 4 个请求，生成 72.48 秒 PCM，用时 103.59 秒，RTF 1.43；Worklet 启动/排空仍各 1 次，34 次欠载共 29.56 秒，句间空白合计 5.86 秒。合批显著减少句界等待，但当前模型吞吐仍低于实时播放速度，长语音会出现句内静音。

同一长文案也对比了 480 ms 与 2 秒模型块。后续句合批时，480 ms 版本共 161 块，音频 76.48 秒、耗时 101.87 秒、RTF 1.33，首声 1.96 秒、欠载静音 24.59 秒；2 秒版本共 39 块，音频 72.48 秒、耗时 103.59 秒、RTF 1.43，首声 3.04 秒、欠载静音 29.56 秒。较大的官方默认块长将消息数量降至约四分之一；本机实测的长文本 RTF 仍超过 1，因此减少块数本身不能消除断供。

实际 WAV 写入 `/tmp/whalepartner-real-single-sentence.wav`、`/tmp/whalepartner-real-multi-sentence.wav`、`/tmp/whalepartner-real-60s-continuous.wav` 和 `/tmp/whalepartner-real-60s-queued-batches.wav`。每份 WAV 的 PCM 长度均与 AudioWorklet 实际播放样本一致。真实模型打断测试在旧请求首块到达后取消该请求，随后用新 turn ID 合成并排空下一轮；turn mismatch 为 0。2 秒块测试中，取消发生在 3.68 秒，新轮首声为 6.41 秒。

真实外放检查以 headful Chromium 的 AudioWorklet 输出到 MacBook Air 内建扬声器，单句 4 块共 6.48 秒，Worklet 正常排空且分析器捕获到 291 个非静音帧。扬声器/麦克风 VAD 检查中，关闭 AGC 后播放期峰值 RMS 为 0.0218，低于 0.03 打断门槛，没有触发回声打断；开启 AGC 时回声 RMS 为 0.22–0.36，会误触发。测试时系统未发现连接的物理耳机端点，耳机路径未实测。

`pnpm --dir apps/client run voice-playback:integration` 使用真实本地模型和 AudioWorklet，检查单句、多句、长中文、流式 WAV、underrun 和打断后快速开始新轮次。默认 Chromium headless；需通过真实系统外放时设置 `WP_VOICE_HEADFUL=1`，必要时用 `CHROME_PATH` 指定 Chrome。

`pnpm --dir apps/client run voice-mode:check` 使用模拟 ASR、LLM 和 TTS，检查提前送入 TTS、情绪标签、单轮 `finish`、AudioWorklet 嘴型波形、用户打断、旧任务取消和麦克风轨道释放。该脚本只验证客户端流程，不作为模型性能数据。

### 模型加速候选

Apple M4、16 GB 上对同一条 Serena 中文短句各预热后重复三次，MLX-Audio 的中位数如下。峰值 RSS 为 worker 进程值：

| 量化 | RTF | 首块 | 峰值 RSS | 预热 |
| --- | ---: | ---: | ---: | ---: |
| 8-bit | 1.124 | 2.398 s | 3.30 GB | 2.79 s |
| 6-bit | 1.015 | 2.198 s | 2.93 GB | 0.82 s |
| 4-bit | 0.859 | 1.872 s | 2.55 GB | 15.86 s |

4-bit 候选通过真实 AudioWorklet 生成 101.44 s PCM、耗时 91.07 s（RTF 0.898），首声 2.07 s，欠载 0 次；合批场景生成 146.88 s、耗时 128.20 s（RTF 0.873），同样欠载 0 次。它仍未达到本轮 RTF ≤ 0.85 的门槛，且该轮没有完成 Serena 音质试听和 ASR 转写对照，因此不替换 8-bit 默认配置。

Pure C/Metal 候选使用上游 [qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts) MIT 代码，隔离版本为 `ef339be`。M4 上编译成功；运行 `./qwen_tts --gpu-selftest --backend metal` 时，批量 FFN 自检相对误差为 1.32 并失败，其他自检项（含单请求 fused FFN）通过。该数值正确性门槛未通过，因此未下载候选权重、未测模型 RTF，也未接入应用。

当前部署继续使用 Qwen3-TTS 1.7B MLX 8-bit。4-bit 与 Pure C/Metal 优化暂搁，等待音质验证或上游 Metal 自检通过后再评估。

## 许可和接口

Qwen3-TTS 1.7B 8-bit 模型卡标注 Apache-2.0；[MLX-Audio](https://github.com/mlx-audio/mlx-audio) 代码采用 MIT。WhalePartner 的 X-ASR 词表与许可说明位于 `apps/api/src/voice/assets/`；上游模型见 [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR)。所有模型权重都留在 WhalePartner 用户数据目录。

语音 API 见 [`API.md`](API.md)：`/api/voice/asr/*` 提供 X-ASR 状态和 WebSocket 流；`/api/voice/tts/*` 提供 TTS 状态、准备和带 turn ID 的 NDJSON 音频流。
