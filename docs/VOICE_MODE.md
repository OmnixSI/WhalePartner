# 语音输入与语音回复

语音输入复用共享聊天和角色上下文。用户点击麦克风开始录音，再点击一次结束录音并发送完整识别文本。客户端采集 16 kHz 单声道 PCM16 并发给本机 API；录音中的停顿只结束内部识别分段，不会自动发送。麦克风音频只在内存中处理，不写入数据库或文件。

## 识别、聊天与合成

- ASR 使用 sherpa-onnx X-ASR 中文/英文 480 ms 流式模型，并对整句做离线精修。流式与离线模型使用不同的编码器和解码器权重：流式模型负责实时 partial，离线模型负责整句重识别。WhalePartner 自己的 RMS VAD 在约 700 ms 静音后收句；流式模型关闭内部端点检测，收句时补 400 ms 静音并冲刷剩余识别状态。随后同一 worker 用离线 X-ASR 模型重识别完整 PCM 句段并补 300 ms 尾音，非空精修稿作为最终稿。录音中的较长停顿可产生多个精修段，但只有用户再次点击麦克风并确认结束后才合并发送。两套模型权重都从 WhalePartner 自己的应用数据目录加载；480 ms 是 ASR 块长，不控制 TTS。
- TTS 使用 [`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit`](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit)，由 WhalePartner 独立 MLX-Audio Python 环境和本地常驻 worker 在 Apple Silicon 上运行，预置 Serena 音色。API 启动时异步加载模型并预热；首次启动会把权重下载到 WhalePartner 自己的应用数据目录。
- 大肥鱼绑定 Serena 音色，并将稳定的角色音色描述与 LLM 发出的结构化情绪标签作为 Qwen3-TTS 指令。情绪标签同时驱动 Live2D 表情；Live2D 嘴型由实际播放 PCM 的 RMS 振幅驱动。
- 回复按自然句界进入 TTS，不等待 LLM 完成整轮回答。过短的句子会和下一句合并，长句在逗号等自然分句标点处拆分。当前最小独立分段长度为 20 个字符。首句立即提交；首句合成期间已排队的后续句子，在角色与情绪一致且合计不超过 180 个字符时合为一个请求，避免每句重复启动模型并保留标点语气。模型流式块长为 2 秒，与 [MLX Audio 的 Qwen3-TTS 默认间隔](https://github.com/Blaizzy/mlx-audio/blob/main/docs/guides/streaming.md)一致。语速按 2026-11-09 在 Apple M4 16 GB QA App 上 100 句实测值计算；生成预算按标准 RTF 1.35 加 0.15 RTF 余量，即计划 RTF 1.50。客户端按 `max(0, 预计音频时长 × 1.50 + 2 秒余量 - 预计音频时长)` 计算首声等待目标，再除以 1.50 得到 AudioWorklet 的 PCM 预缓冲长度；字数统计 Unicode 字母和数字，不计空格与标点。20 字预计音频时长 5.84 秒，计划生成时长 8.76 秒，目标等待约 4.92 秒、PCM 水位约 3.28 秒。实际起播还受音频块到达时间影响；若整轮结束时 PCM 未达到目标，则收到 finish 后立即播放。
- 预缓冲余量为一个 2 秒流式块，计划 RTF 另含 0.15 冗余。例如 10 秒音频按计划 RTF 1.50，生成预算 15 秒；加上 2 秒余量并扣除 10 秒播放时长，目标等待 7 秒，对应 PCM 预缓冲约 4.67 秒。目标随着回复长度更新；实际首声受目标 PCM 到达时间影响。实测 RTF 仍记录在校准报告中；计划值使用本机实测语速和用户指定的 RTF 1.35 + 0.15 余量。
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

权重和 Python 环境不提交 Git。ASR、TTS 与已启用的本地记忆向量模型都在 API 启动后异步加载并预热，模型状态可从本机 API 观察；进入功能时只等待启动中的模型就绪。TTS 仅在 Apple Silicon macOS 上启用；语音播放仅在大肥鱼人格和用户主动开启语音模式时启用。

## 本机验证

测试设备为 Apple M4、16 GB 内存，MLX-Audio 0.6.4 / Python 3.12.7。X-ASR 使用本机两套 INT8 权重和 sherpa-onnx 1.13.8；合成的 4.96 秒中文音频按 100 ms 帧输入后，流式稿连续出现，两个自然句末均由 VAD 收句并产生离线精修稿。2 秒配置的桌面包启动后，API 状态显示 X-ASR 流式与离线精修、Qwen3-TTS 和本地记忆均为 ready。早期 8-bit 长语音测量期间，TTS worker `vmmap` 当前物理占用 3.1 GiB、进程峰值 6.2 GiB。

早期整轮 AudioWorklet 回归使用本机 Qwen3-TTS 1.7B 8-bit Serena，经本机 API 和 Chromium AudioWorklet 播放。测试捕获的是 Worklet 实际输出的 PCM；首声时间从发起首句请求计到 Worklet 启播，RTF 为整段请求生成耗时除以 PCM 时长。整轮协议只启动/排空一次 Worklet；对照逐句发送 `finish` 的协议，三句样本句间空白由 5.29 秒降至 3.86 秒，首声由 4.70 秒降至 3.35 秒。合并后续两句后，TTS 请求从 3 次降到 2 次，首声 2.30 秒、句间空白 0.89 秒、RTF 1.36，欠载静音 7.86 秒。

60 秒以上中文长测中，逐句请求生成 74.96 秒 PCM，用时 132.49 秒，RTF 1.77；Worklet 启动/排空各 1 次，欠载静音 56.50 秒。采用产品实际策略（首句立即合成，余句按不超过 180 字合并）后，10 句成为 4 个请求，生成 72.48 秒 PCM，用时 103.59 秒，RTF 1.43；Worklet 启动/排空仍各 1 次，34 次欠载共 29.56 秒，句间空白合计 5.86 秒。合批显著减少句界等待，但当前模型吞吐仍低于实时播放速度，长语音会出现句内静音。

同一长文案也对比了 480 ms 与 2 秒模型块。后续句合批时，480 ms 版本共 161 块，音频 76.48 秒、耗时 101.87 秒、RTF 1.33，首声 1.96 秒、欠载静音 24.59 秒；2 秒版本共 39 块，音频 72.48 秒、耗时 103.59 秒、RTF 1.43，首声 3.04 秒、欠载静音 29.56 秒。较大的官方默认块长将消息数量降至约四分之一；本机实测的长文本 RTF 仍超过 1，因此减少块数本身不能消除断供。

实际 WAV 写入 `/tmp/whalepartner-real-single-sentence.wav`、`/tmp/whalepartner-real-multi-sentence.wav`、`/tmp/whalepartner-real-60s-continuous.wav` 和 `/tmp/whalepartner-real-60s-queued-batches.wav`。每份 WAV 的 PCM 长度均与 AudioWorklet 实际播放样本一致。真实模型打断测试在旧请求首块到达后取消该请求，随后用新 turn ID 合成并排空下一轮；turn mismatch 为 0。2 秒块测试中，取消发生在 3.68 秒，新轮首声为 6.41 秒。

真实外放检查以 headful Chromium 的 AudioWorklet 输出到 MacBook Air 内建扬声器，单句 4 块共 6.48 秒，Worklet 正常排空且分析器捕获到 291 个非静音帧。扬声器/麦克风 VAD 检查中，关闭 AGC 后播放期峰值 RMS 为 0.0218，低于 0.03 打断门槛，没有触发回声打断；开启 AGC 时回声 RMS 为 0.22–0.36，会误触发。测试时系统未发现连接的物理耳机端点，耳机路径未实测。

`pnpm --dir apps/client run voice-playback:integration` 使用真实本地模型和 AudioWorklet，检查单句、多句、长中文、流式 WAV、underrun 和打断后快速开始新轮次。默认 Chromium headless；需通过真实系统外放时设置 `WP_VOICE_HEADFUL=1`，必要时用 `CHROME_PATH` 指定 Chrome。

`pnpm --dir apps/client run voice-mode:check` 使用模拟 ASR、LLM 和 TTS，检查提前送入 TTS、情绪标签、单轮 `finish`、AudioWorklet 嘴型波形、用户打断、旧任务取消和麦克风轨道释放。该脚本只验证客户端流程，不作为模型性能数据。

### 模型加速候选

Apple M4、16 GB 上对同一条 Serena 中文短句各预热后重复三次，MLX-Audio 的历史中位数如下。峰值 RSS 为 worker 进程值：

| 量化 | RTF | 首块 | 峰值 RSS | 预热 |
| --- | ---: | ---: | ---: | ---: |
| 8-bit | 1.124 | 2.398 s | 3.30 GB | 2.79 s |
| 6-bit | 1.015 | 2.198 s | 2.93 GB | 0.82 s |
| 4-bit | 0.859 | 1.872 s | 2.55 GB | 15.86 s |

4-bit 真实 AudioWorklet 长语音生成 101.44 s PCM，用时 91.07 s（RTF 0.898），首声 2.07 s、欠载 0 次；合批场景生成 146.88 s，用时 128.20 s（RTF 0.873），同样欠载 0 次。两项都低于当前 RTF <1 的要求。

2026-11-09 在 WhalePartner 常驻 worker 上用相同长中文段落重新比较。8-bit 生成 23.76 s PCM，用时 27.485 s（RTF 1.157），首块 2.877 s；4-bit 生成 28.88 s PCM，用时 25.633 s（RTF 0.888），首块 2.196 s。4-bit 在同一 worker 配置下低于 RTF 1，因而作为当前 TTS 模型；历史 8-bit 样本保留为基线。此前 X-ASR 对相同短句的 8-bit 和 4-bit 转写词句一致，仅有标点差异。

Pure C/Metal 使用上游 [qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts) MIT 代码，隔离版本为 `ef339be`。首次 `ffn_batched B=16` rel=1.32 来自 CPU 自检参考路径的 KleidiAI BF16 打包缓存：缓存只按权重指针索引，单 FFN 测试释放临时权重时没有注销缓存，下一组测试复用同一地址后，CPU 参考命中了旧打包权重。Metal 上传权重与输入布局正确，逐层 CPU/Metal 对照没有发现矩阵布局或输出缓冲复用错误。

自检现在对 B=1、2、8、16 分别比较 RMSNorm、Gate/Up、SwiGLU、Down、Residual 和融合 FFN；临时 CPU 参考权重在释放/复用前注销 KAI 缓存。最终 Metal kernel 在 `simdgroup_store` 后保留 threadgroup barrier，使临时共享缓冲的写入先于后续读取，符合 [Apple 的 Metal 内存同步要求](https://developer.apple.com/documentation/apple-silicon/porting-your-metal-code-to-apple-silicon)。`make metal_build` 后完整 `./qwen_tts --gpu-selftest --backend metal` 连续三次通过，B=16 融合 rel=0.00315，低于 0.005 阈值。

最终 Pure C/Metal int4 在同一段中文上生成 25.44 s PCM，用时 28.5 s（RTF 1.12），TTFA 7.954 s，未达到 RTF <1 的要求，因此没有接入 WhalePartner。相同文本的 MLX 4-bit 常驻 worker RTF 为 0.888，生成 28.88 s PCM，用时 25.633 s，首块 2.196 s。Pure C/Metal 4-bit 的 Talker 和 Code Predictor 使用 resident Metal step；该构建的语音解码耗时 17.585 s 并与生成重叠，整轮依然受逐帧 Talker/Code Predictor 计算和 prefill 时间限制。

### 当前 4-bit 常驻 worker 与 AudioWorklet 复测（2026-11-09）

对正在运行的打包 app 只读查询状态时，Qwen3-TTS 1.7B MLX 4-bit Serena、X-ASR 480 ms 流式模型和离线整句精修均为 `ready`。Sidecar 打开的数据库路径是 WhalePartner 自己的 `~/Library/Application Support/com.omnixsi.whalepartner/app.db`。下表来自真实本机模型响应和 Chromium AudioWorklet 捕获的 PCM；这些性能样本记录于固定 1.44 秒起播水位配置。RTF = TTS 生成耗时 ÷ PCM 时长，“首播”是 Worklet 启播时刻，“句间静音”只合计各 TTS 片段 PCM 自带的首尾静音，不含设备播放检查。所有场景的 Worklet 均只启动/排空一次，underrun 均为 0。

| 场景 | TTS 请求数 | PCM 时长 | 生成耗时 | RTF | Worklet 首播 | 句间静音 | underrun |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 单句 | 1 | 7.36 s | 6.84 s | 0.929 | 2.13 s | — | 0 |
| 三句整轮连续播放 | 3 | 41.12 s | 36.58 s | 0.890 | 2.06 s | 181 ms | 0 |
| 三句后续合批 | 2 | 44.00 s | 38.75 s | 0.881 | 2.10 s | 100 ms | 0 |
| 十句长中文 | 10 | 122.64 s | 108.90 s | 0.888 | 2.16 s | 956 ms | 0 |
| 十句按语义合批 | 4 | 139.28 s | 125.25 s | 0.899 | 2.07 s | 428 ms | 0 |

这轮长文案实际生成 122.64 秒与 139.28 秒 PCM，持续时间超过 60 秒。程序化打断在旧轮首块到达后取消 TTS 和播放队列，再以新 turn ID 合成下一轮；旧流在约 2.14 秒时被取消，新轮 Worklet 首播约 3.80 秒，turn mismatch 为 0。此项验证覆盖真实模型和 Worklet 的取消协议，不代替真实麦克风收音测试。

同一段中文和 Serena 角色提示的实际合成样本：中性 [neutral](evidence/voice/qwen3-tts-serena-neutral.wav)、开心 [happy](evidence/voice/qwen3-tts-serena-happy.wav)、安慰 [comfort](evidence/voice/qwen3-tts-serena-comfort.wav)、舒缓 [relaxed](evidence/voice/qwen3-tts-serena-relaxed.wav)，以及采用自然语速提示的 [relaxed-natural](evidence/voice/qwen3-tts-serena-relaxed-natural.wav)。四个情绪标签的生成 RTF 依次为 0.886、0.849、0.855、0.849。项目离线 X-ASR 对新旧舒缓样本整段识别均得到完整原句；自然语速样本长 11.68 秒，旧舒缓样本长 15.2 秒。当前 `relaxed` 指令已改为自然语速、短停顿和整句连贯，避免模型按“节奏舒缓”拉长语速。

本次 `card-preview:check` 在桌面与 390 × 844 视口通过，卡面没有内部文字、人物比例符合约束、Live2D 只初始化一个渲染器，等级切换不重载模型；共享 Pixi ticker 在三秒观察窗内渲染 180 帧（60 FPS）。`voice-mode:check` 的模拟收音、LLM 流式、情绪映射、打断与下一轮隔离全部通过。headless Chromium 的 AudioWorklet 结果不代表实体扬声器或耳机；目前未连接耳机，本轮也未完成解锁后的 Tauri 麦克风验收。

### WhalePartner 桌面 QA App 的 100 句缓冲校准（2026-11-09）

校准通过已构建并启动的 Tauri QA App 及其常驻 API/MLX worker 完成，模型为 Qwen3-TTS 1.7B MLX 4-bit Serena，情绪为 neutral。设备为 Apple M4、16 GB、macOS 26.5.2。100 条确定性打乱的合成中文句子覆盖 5–36 个汉字，共 2,060 个汉字，生成 601.44 秒 PCM，耗时 562.44 秒；加权 RTF 为 0.9352，单句 RTF 中位数 0.9413、P90 为 1.1009。实测语速为每秒 3.425 字，即每 10 字约 2.92 秒；首音频块延迟中位数 1.972 秒、P90 为 2.224 秒。共收到 346 个 TTS 块；PCM 总时长对应 301 个完整 2 秒块，按逐句取整则为 346 块。

计划生成 RTF 为 1.50（标准 1.35 + 0.15 余量），另加 2 秒流式块预留。首声等待按 `max(0, 预计音频秒数 × 1.50 + 2 秒 - 预计音频秒数)` 计算；Worklet 的 PCM 水位为该等待秒数除以 1.50。20 字对应约 4.92 秒首声目标和 3.28 秒 PCM 水位；10 秒音频对应 7 秒目标和 4.67 秒 PCM 水位。目标在播放开始前随 LLM 已生成文本更新；开始播放后保持不变。实际起播等目标 PCM 到达；若整轮先结束，则收到 `finish` 后立即排空已有 PCM。

QA App 使用独立 bundle ID `com.omnixsi.whalepartner.voiceqa` 和独立应用数据目录；模型与运行时从 WhalePartner 自己的数据目录做 APFS 克隆，未访问 InterviewHacker 资源或正式数据库。测试只调用 TTS 流接口，不发聊天请求、不保存 WAV。只读核对 QA 库时 `chat_sessions`、`messages` 与 `usage_ledger` 均为 0。完整 100 条输入与逐条指标见 [`qwen3-tts-100-sentence-calibration.json`](evidence/voice/qwen3-tts-100-sentence-calibration.json)，可复现脚本见 [`tts-buffer-calibration.mjs`](../apps/client/scripts/tts-buffer-calibration.mjs)。此项测量验证实际模型推理速度，不代表 AudioWorklet 起播或实体扬声器欠载结果。

## 许可和接口

Qwen3-TTS 1.7B 模型及 MLX 社区量化变体沿用上游 Apache-2.0 许可；[MLX-Audio](https://github.com/mlx-audio/mlx-audio) 代码采用 MIT。WhalePartner 的 X-ASR 词表与许可说明位于 `apps/api/src/voice/assets/`；上游模型见 [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR)。所有 WhalePartner 模型权重都留在其应用数据目录。

语音 API 见 [`API.md`](API.md)：`/api/voice/asr/*` 提供 X-ASR 状态和 WebSocket 流；`/api/voice/tts/*` 提供 TTS 状态、准备和带 turn ID 的 NDJSON 音频流。
