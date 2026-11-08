# 连续语音与情绪语音

连续语音复用现有共享聊天和人格上下文。浏览器采集麦克风 PCM16 单声道音频并以 16 kHz 帧发送给本机 API；原始音频不写入 SQLite 或磁盘。每次识别只把 X-ASR 最终稿提交到正常聊天接口，中间识别稿仅显示在语音状态中。

## 识别、聊天与合成

- ASR：InterviewHacker 使用的 sherpa-onnx X-ASR 中文/英文 480 ms chunk 流式模型。WhalePartner 只在自己的应用数据目录加载副本；副本缺失时从 sherpa-onnx 官方发布下载，不读取其他项目目录。worker 使用 16 kHz PCM、BPE 词表和端点检测。
- 聊天：继续使用当前角色和现有服务端模型配置。情绪事件先于回复正文到达；正文分句后才提交 TTS，不逐 token 合成。
- TTS：`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit`，通过 MLX-Audio 在 Apple Silicon 本机运行，预置 Serena 音色，不使用参考录音或克隆真人声音。Qwen 的 `instruct` 字段支持音色风格、情绪和韵律指令；WhalePartner 将六种情绪映射为这些指令。它是自然语言指令控制，输出仍由模型生成，不保证每次都呈现固定强度。
- 音频以 24 kHz PCM16 流式返回，浏览器顺序排队播放。新语音输入会取消聊天请求、终止当前 TTS 请求并清空旧播放队列。Live2D 嘴型读取实际播放波形音量；纯文字回复保留原文字计时嘴型。

## 数据和运行环境

默认数据目录为 `~/Library/Application Support/com.omnixsi.whalepartner/`：

- X-ASR 权重：`models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05/`
- Qwen TTS 模型缓存：`models/tts/hf/`
- sherpa-onnx Python 环境：`runtimes/asr-sherpa/`
- MLX-Audio Python 环境：`runtimes/tts-mlx/`

权重和 Python 环境不提交 Git。TTS 首次使用会显示准备状态，在独立 Python venv 中安装 MLX-Audio 并下载模型；缓存后启动本机 worker 并预热短音频。TTS 目前只在 Apple Silicon macOS 上启用。语音播放只在大肥鱼的人格和显式开启的连续语音模式下自动触发。

## 本机实测

测试设备为 Apple M4、16 GB 内存；使用固定合成中文文本和临时聊天服务，不录制真实麦克风，也不调用付费聊天模型。缓存模型的 worker 启动和预热约 8.4 秒；预热后 API 首段音频约 0.58 秒。Serena 样本共 7 个音频块，约 3.12 秒。取消首段播放后，worker 可继续生成下一条音频。打包后的 arm64 X-ASR worker 也已用该固定样本完成 16 kHz 重采样和流式识别，最终稿为“你好，今天聊聊最近发生的事情吧”；worker 从 WhalePartner 应用数据目录加载模型。先前单独推理探测的 Python worker 峰值 RSS 约 2.1 GiB。实际音色自然度尚未由人工听评。

合成样本：[qwen3-tts-serena-sample.wav](evidence/voice/qwen3-tts-serena-sample.wav)。

## 浏览器模拟验收

运行 `pnpm --dir apps/client run voice-mode:check` 会启动隔离的 Vite 页面并模拟 ASR、聊天和 TTS 接口及合成麦克风音频。检查无麦克风错误恢复、三轮连续对话、最终稿只提交一次、多句回复按句生成并排队、情绪映射、说话打断、退出停止麦克风轨道和关闭 ASR WebSocket。该检查不调用模型、不录制真实麦克风，也不修改用户数据库；本机模型推理和打包 sidecar 另按上文记录实测。默认使用 Playwright 管理的 Chromium；本机已有 Chrome 时可用 `CHROME_PATH` 指定其可执行文件。

## 许可和接口

Qwen3-TTS 的 [官方模型卡](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) 和 [MLX 4-bit 权重卡](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit) 标注 Apache-2.0；[MLX-Audio](https://github.com/Blaizzy/mlx-audio) 代码采用 MIT。[Qwen3-TTS 官方说明](https://github.com/QwenLM/Qwen3-TTS) 定义 CustomVoice 的 instruction 控制能力；[MLX-Audio 的模型文档](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md) 记录分段流式接口。WhalePartner 的 X-ASR 词表和许可说明位于 `apps/api/src/voice/assets/`；上游模型见 [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR)。所有模型权重留在用户数据目录。

语音 API 见 [`API.md`](API.md)：`/api/voice/asr/*` 提供 X-ASR 状态和 WebSocket 流；`/api/voice/tts/*` 提供 TTS 状态、准备和 NDJSON 音频流。
