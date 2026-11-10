# 语音输入与语音回复

语音输入复用共享聊天和角色上下文。用户从文字模式点“语音聊天”开始录音；录音时可发送或取消。发送会结束录音并提交完整识别文本一次，取消会丢弃本次未提交内容。录音中的停顿只结束内部识别分段，不会自动发送。客户端采集 16 kHz 单声道 PCM16 并发给本机 API；麦克风音频只在内存中处理，不写入数据库或文件。

## 识别、聊天与合成

- ASR 使用 sherpa-onnx X-ASR 中文/英文 480 ms 流式模型，并对整句做离线精修。流式模型负责实时 partial，离线模型负责整句重识别。WhalePartner 的 RMS VAD 在约 700 ms 静音后收句；随后同一 worker 用离线模型重识别完整 PCM 句段。多段精修稿只在用户结束录音后合并发送。两套 ASR 权重都从 WhalePartner 自己的应用数据目录加载。
- 大肥鱼语音回复使用 [Fun-CosyVoice3-0.5B-2512](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)，通过固定版本的 [CosyVoice MPS 支持代码](https://github.com/ZoneTwelve/CosyVoice-MPS) 在 Apple Silicon 上推理。PyTorch MPS 承载主要模型计算；说话人嵌入和语音分词使用 ONNX CPU provider。模型权重和独立 Python 环境保存在 WhalePartner 应用数据目录。
- 大肥鱼的默认预设音色使用 CosyVoice 说话人配置。`voices/big-fish/keli_voice/speaker.pt` 保存预计算的 prompt、语音特征与说话人嵌入；`voice.json` 记录模型和逐字稿；`reference.wav` 保留配置来源。配置在本机使用 PyTorch 安全权重加载，不上传到模型服务。缺少配置文件时，TTS 状态为 `waiting_reference`，语音合成不会回退到旧参考音频或其他音色。
- 说话人配置沿用导入时的 prompt 与音色特征；结构化情绪标签继续控制 Live2D 表情，嘴型由实际播放 PCM 的 RMS 振幅驱动。
- 回复按自然句界进入 TTS。过短句子会和下一句合并，长句在自然分句标点处拆分；首句立即提交，已排队的后续句子在角色与情绪一致且合计不超过 180 个字符时合并。每个 TTS 请求以 `segment-done` 标记单句完成；只有 LLM 已结束且本轮队列排空后，客户端才向 AudioWorklet 发送一次 `finish`。
- 播放队列直接拼接 PCM，不在每个流式块后插入静音。用户打断会停止当前播放、取消聊天与 TTS 请求并清空旧队列；AudioWorklet 拒绝不匹配的 turn ID。日志记录 turn、segment、chunk、缓冲量、欠载和打断状态。
- 麦克风请求启用系统回声消除和降噪，关闭自动增益控制（AGC）。助手播放期间用 0.03 RMS、连续 180 ms 的门槛识别用户打断；普通聆听期间使用 0.018 RMS、连续 120 ms。

## 数据目录与运行环境

默认数据目录为 `~/Library/Application Support/com.omnixsi.whalepartner/`：

- CosyVoice3 模型：`models/tts/cosyvoice3/`
- CosyVoice3 Python 环境：`runtimes/tts-cosyvoice3/`
- 固定版本的 MPS 推理源代码：`runtimes/cosyvoice3-source/`
- 大肥鱼 CosyVoice 音色配置：`voices/big-fish/keli_voice/`
- X-ASR 权重和 Python 环境继续分别保存在 `models/` 与 `runtimes/asr-sherpa/`

CosyVoice 源代码固定在 `9060a7a641c62ac47ce179191c7cd4aea4af919a`；模型固定在 `29e01c4e8d000f4bcd70751be16fa94bf3d85a18`，只下载推理所需文件，不下载 RL 权重和 CUDA/TensorRT 加速文件。Python 依赖与 MPS 环境检查由 `apps/api/scripts/setup-cosyvoice3-runtime.sh` 管理。首次需要语音回复时，若运行环境或模型尚未准备好，API 会在 WhalePartner 专属目录中安装和下载。

升级启动时，API 会清理 WhalePartner 原有的 `models/tts/hf/` Qwen TTS 缓存和 `runtimes/tts-mlx/` 环境；清理范围不包含 ASR、聊天、记忆或其他应用数据。

模型与 CosyVoice MPS 代码采用 Apache-2.0 许可。WhalePartner 的 X-ASR 模型许可说明位于 `apps/api/src/voice/assets/`；所有模型权重和参考音频都留在本机应用数据目录，不提交到 Git。

## 验证状态

开发者提供的 CosyVoice3 说话人配置已导入为大肥鱼默认预设音色。配置文件只保存在本机应用数据目录，不进入仓库。

试听与桌面应用检查结果记录在关联 Issue 和 Pull Request 中。冷启动期间，API 会在后台准备模型并预热。
