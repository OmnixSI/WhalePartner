# 本机 macOS 签名

WhalePartner 使用 bundle identifier `com.omnixsi.whalepartner`。当前本机开发默认使用 ad-hoc 签名（`apps/client/src-tauri/tauri.conf.json` 中的 `signingIdentity: "-"`），不会复用其他应用的签名身份。ad-hoc 签名不保持跨版本稳定的 TCC designated requirement，因此重建后 macOS 可能再次询问 WhalePartner 的麦克风权限。不要通过重置 TCC 数据库处理授权提示。

如果以后需要稳定保留本机麦克风授权，可在「钥匙串访问 → 证书助理 → 创建证书」中为 WhalePartner 单独创建一个自签代码签名证书，保存到登录钥匙串，并将其完整身份名称设置为 `signingIdentity`。不要将其它项目的证书用于 WhalePartner。自签证书仅适用于创建它的本机，不提供公证或公开分发信任；正式分发仍需 Developer ID 与公证。

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
