# Third-party notices

鲸汐的源码里有一部分改写自下列开源项目。它们没有作为依赖安装，代码已经按本项目的写法重写；下面保留原项目的许可声明。

## meta/astryx

- 来源：https://github.com/meta/astryx ，参照提交 319528c5b5ef6655589d05bf39f5828f5d61d97a（2026-11-11）
- 许可：MIT
- 改写的部分：
  - `apps/client/src/components/ui/shared.css`：交互叠层（hover / 按下叠一层半透明色，不换底色）
  - `apps/client/src/components/ui/Button.tsx`、`Button.css`：按钮结构、按下微缩（触屏和降级动效下不缩）
  - `apps/client/src/components/ui/Switch.css`：开关结构
  - `apps/client/src/styles/tokens.css`：语义色的分层方式（body / surface / card / popover / muted …）；数值是鲸汐自己的

```
MIT License

Copyright (c) 2026 Meta Platforms, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
