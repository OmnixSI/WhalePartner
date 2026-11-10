# 语音输入与语音回复

语音输入复用共享聊天和角色上下文。用户从文字模式点“语音聊天”开始录音；录音时可发送或取消。发送会结束录音并提交完整识别文本一次，取消会丢弃本次未提交内容。录音中的停顿只结束内部识别分段，不会自动发送。客户端采集 16 kHz 单声道 PCM16 并发给本机 API；麦克风音频只在内存中处理，不写入数据库或文件。

## 识别、聊天与合成

- ASR 使用 sherpa-onnx X-ASR 中文/英文 480 ms 流式模型，并对整句做离线精修。流式模型负责实时 partial，离线模型负责整句重识别。WhalePartner 的 RMS VAD 在约 700 ms 静音后收句；随后同一 worker 用离线模型重识别完整 PCM 句段。多段精修稿只在用户结束录音后合并发送。两套 ASR 权重都从 WhalePartner 自己的应用数据目录加载。
- 设置页的「语音环境」提供一键配置和重建，分别准备 X-ASR 与 CosyVoice3 的模型权重和本机运行时。新安装默认不在启动时下载这些资源；用户启动配置后才按需获取。首次完整配置需联网下载约 2.8 GB。重建只删除这两套语音环境及其安装残留，重新下载/构建后保留音色配置和其他应用数据。Codex 的模型与运行环境不由此功能管理。
- 大肥鱼语音回复使用 [Fun-CosyVoice3-0.5B-2512](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) 的 MLX FP16 检查点，由固定版本的 [SGLang-Omni 原生运行时](https://github.com/sgl-project/sglang-omni/tree/93cba1822e2be00e917206de74c23027e4cf74e7/sglang_omni_mlx/native) 在 Apple Silicon 上执行 C++ 推理。合成进程不加载 PyTorch、ONNX Runtime 或 Python。请求使用 top-p 0.8、top-k 25、语速 1.0；不注入固定语气指令。输出为 24 kHz 单声道 PCM16。原生接口在整段回答合成和声码器处理完成后返回 PCM，WhalePartner 再按 350 ms 分块排入播放队列。
- 大肥鱼的默认预设音色由随应用提供的 `apps/api/src/voice/assets/keli_voice/voice.json` 与 `reference.wav` 配置。用户数据目录中的 `voices/big-fish/keli_voice/voice.json` 和 `reference.wav` 存在时优先使用用户版本。原生 MLX 后端从 WAV 和逐字稿计算 CAMPPlus 说话人特征与 S3 语音 token，并在运行进程内缓存；不会读取、生成或打包 PyTorch `speaker.pt`。没有可用音色配置时，TTS 状态为 `waiting_reference`，不会回退到其他音色。
- 结构化情绪标签继续控制 Live2D 表情，嘴型由实际播放 PCM 的 RMS 振幅驱动。
- 聊天文字继续随 LLM 输出逐步显示；语音客户端先收集本轮完整回答，等 LLM 结束后将其作为一个 TTS 请求提交，不按句子或标点拆分。单次请求上限为 1200 个字符；超出时 API 拒绝语音请求，但不影响已显示的文字回答。
- CosyVoice 完成整段合成后返回 PCM；客户端将音频分成 350 ms 块交给 AudioWorklet，播放器预缓冲 350 ms 后连续播放本轮回答。用户打断会停止当前播放、取消聊天与 TTS 请求并清空旧队列；AudioWorklet 拒绝不匹配的 turn ID。日志记录 turn、segment、chunk、缓冲量、欠载和打断状态。
- 麦克风请求启用系统回声消除和降噪，关闭自动增益控制（AGC）。助手播放期间用 0.03 RMS、连续 180 ms 的门槛识别用户打断；普通聆听期间使用 0.018 RMS、连续 120 ms。

## 数据目录与运行环境

默认数据目录为 `~/Library/Application Support/com.omnixsi.whalepartner/`：

- CosyVoice3 MLX FP16 模型：`models/tts/cosyvoice3-mlx-fp16/`
- CosyVoice3 原生 MLX 运行时：`runtimes/tts-cosyvoice3-mlx-native/`
- 用户自定义的大肥鱼 CosyVoice 音色配置：`voices/big-fish/keli_voice/`；默认音色随应用打包
- X-ASR 权重和 Python 环境继续分别保存在 `models/` 与 `runtimes/asr-sherpa/`

原生运行时固定在 SGLang-Omni 提交 `93cba1822e2be00e917206de74c23027e4cf74e7`，最低支持 macOS 15。FP16 模型固定在 `18ccb7fbd7246e8cd3420d02f5dd28595cc0fcd9`，S3 tokenizer 固定在 `b143914b3e912278104824da706edc9c2d317c4e`。通过设置页配置语音环境，或在未配置时首次发起合成，API 会在 WhalePartner 专属数据目录构建 C++ 运行时并下载模型；构建工具和源代码放在临时目录，构建完成后清理。原生合成成功后，会删除旧 CosyVoice TTS 模型与运行时目录；X-ASR、聊天、记忆和音色文件不在清理范围内。

Fun-CosyVoice3 原始模型卡声明 Apache-2.0；SGLang-Omni 原生运行时采用 Apache-2.0，许可证随本机编译运行时保存。WhalePartner 的 X-ASR 模型许可说明位于 `apps/api/src/voice/assets/`。模型权重仍按需下载到本机应用数据目录；获准分发的大肥鱼参考音频和配置随应用安装包提供。

## 验证状态

大肥鱼预设音色会随应用提供。设置页可安装或重建 X-ASR 与 CosyVoice3 环境；完成后验证状态应显示「已就绪」，语音聊天可使用 X-ASR 转写与预设音色回答。CosyVoice 需要 macOS 15 或更新版本的 Apple Silicon。

### 原生 MLX RTF 实测

在 Apple M4 MacBook Air（8 核 GPU、16 GB）、macOS 26.5.2 上，用 MLX 0.32.3、固定的 FP16 检查点和大肥鱼导入音色进行单并发合成。相同 36 字中文文本使用 seed 1 连续请求 5 次，采样率 24 kHz；RTF 按合成耗时除以 PCM 时长计算。

| 请求 | 合成耗时 | 音频时长 | RTF | 首个音频可用时间 |
| --- | ---: | ---: | ---: | ---: |
| 首次请求 | 10.76 s | 7.88 s | 1.365 | 10.76 s |
| 后续 4 次加权值 | 10.82 s/次 | 7.88 s/次 | 1.373 | 10.82 s/次 |
| 后续 4 次中位数 | — | — | 1.368 | — |

移除应用目录中的旧 `speaker.pt` 后，从空缓存的 MLX 服务进程再次读取同一 WAV 和逐字稿，单次重新提取音色特征并合成耗时 11.61 s，生成 7.88 s 音频（RTF 1.474）。这是一条冷缓存单次样本；稳定多次请求仍以上表的连续 4 次加权值为准。

### 当前桌面版 API 路由 RTF 复测

从提交 `580d66e` 构建的 WhalePartner 桌面版 API 路由串行请求同一段 36 字文本 5 次，使用当前应用默认采样参数、不固定随机种子，24 kHz 单声道。设备接通 AC 电源；系统未报告热或性能警告。

| 请求 | 服务端合成耗时 | 音频时长 | RTF | 首个音频到达 |
| --- | ---: | ---: | ---: | ---: |
| 首次请求 | 23.93 s | 7.64 s | 3.132 | 23.95 s |
| 请求 2 | 26.03 s | 8.08 s | 3.222 | 26.05 s |
| 请求 3 | 20.22 s | 7.92 s | 2.554 | 20.23 s |
| 请求 4 | 20.75 s | 7.76 s | 2.674 | 20.76 s |
| 请求 5 | 19.98 s | 7.92 s | 2.523 | 19.99 s |
| 后 4 次加权值 | 21.75 s/次 | 7.92 s/次 | 2.746 | 21.75 s/次 |
| 后 4 次中位数 | — | — | 2.674 | — |

本次桌面版路由 RTF 明显高于前面的独立原生服务基准；差异原因尚未隔离。评估当前应用体验时应以桌面版路由的加权 RTF 2.746 为准，约需 2.75 秒生成 1 秒语音，且整句完成后才有首段音频。

前述独立原生服务的种子固定测试约需 1.37 秒生成 1 秒语音；整句生成和声码器完成后才返回 PCM，首个可播放音频约需 10.8 秒。对照项是 SGLang-Omni 在 M4 10 核 GPU 上以 SeedTTS 中文集合测得的 RTF 0.625；该集合、参考音频和统计方法不同，不能视为同一基准的直接复测。[性能记录](https://github.com/sgl-project/sglang-omni/discussions/2158)；[原生实现及基准说明](https://github.com/sgl-project/sglang-omni/pull/3140)。

模型准备在后台进行；设备、文本与实测数据也记录在关联 Issue 和 Pull Request 中。
