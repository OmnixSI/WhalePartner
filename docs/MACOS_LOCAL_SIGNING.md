# 本机 macOS 签名

WhalePartner 使用 Tauri macOS bundle identifier `com.omnixsi.whalepartner`。本机开发包使用稳定的自签代码签名身份，使系统能把麦克风等隐私授权关联到同一应用身份。该签名用于本机开发，不提供公证或公开分发信任。

## 配置身份

仓库当前的本机默认身份是 `InterviewHacker Local Signing`。如果你的登录钥匙串已有长期自签代码签名身份，可将 `apps/client/src-tauri/tauri.conf.json` 中 `bundle.macOS.signingIdentity` 改为 `security find-identity -v -p codesigning` 输出的完整身份名称。

如果没有可复用身份，在「钥匙串访问」中打开「证书助理 → 创建证书」，身份类型选「自签根证书」、证书类型选「代码签名」，保存到登录钥匙串。将该身份名称设为 `signingIdentity`。只创建一次并保管好私钥；不需要 Apple Developer 账号。

也可以通过 `APPLE_SIGNING_IDENTITY` 环境变量为单次构建指定身份；它会覆盖 Tauri 配置中的 `signingIdentity`。

## 构建与核验

使用 Node 26 构建：

```sh
pnpm --dir apps/client run tauri build --bundles app
```

验证最终 `.app` 的签名与 bundle identifier：

```sh
codesign --verify --deep --strict --verbose=2 apps/client/src-tauri/target/release/bundle/macos/鲸汐.app
codesign -dv --verbose=4 apps/client/src-tauri/target/release/bundle/macos/鲸汐.app
codesign --display -r - apps/client/src-tauri/target/release/bundle/macos/鲸汐.app
```

同一身份重建时，签名 authority 和 designated requirement 应保持稳定；代码变化会改变 cdhash。只有身份变化导致旧授权失效时，才退出全部鲸汐进程，并按需重置 `com.omnixsi.whalepartner` 对应的单项 TCC 服务，之后由 macOS 重新询问用户。不要修改 TCC 数据库或重置其他应用的权限。
