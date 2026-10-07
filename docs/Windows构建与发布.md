# Windows 构建与发布

## 1. 目标

生成可在 Windows x64 上独立安装和运行的 NSIS 安装包。安装包内置 FFmpeg 与 ffprobe，终端用户不需要单独配置系统 PATH。

## 2. 本地构建

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run package:win
```

产物位于：

```text
release/
```

## 3. 安装包内容

Electron Builder 会把：

- `node_modules/ffmpeg-static/ffmpeg.exe`
- `node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe`

复制到安装后的：

```text
resources/bin/ffmpeg.exe
resources/bin/ffprobe.exe
```

应用运行时优先级：

1. `FFMPEG_PATH` / `FFPROBE_PATH` 环境变量；
2. 安装包 `resources/bin`；
3. 系统 PATH 中的 `ffmpeg` / `ffprobe`。

## 4. CI

每次 push 到 main：

1. npm ci
2. TypeScript typecheck
3. Vitest 单元 + FFmpeg 集成测试
4. production build
5. Windows NSIS package
6. 上传安装包为 GitHub Actions artifact

只有全部步骤通过，当前迭代才视为完成。

## 5. 发布前检查

- 安装程序可以启动。
- 可修改安装路径。
- 创建桌面/开始菜单快捷方式。
- `resources/bin` 中存在 FFmpeg 与 ffprobe。
- 打开本地 MP4 可播放。
- 静止区间检测可运行。
- 多选静止区间后可导出 MP4。
- 有音频/无音频视频均可导出。
- 源视频不被覆盖。
- 取消或失败时不遗留伪成功输出文件。

## 6. FFmpeg 分发说明

正式公开发布前需要复核所使用 FFmpeg 二进制的许可证、构建选项以及对应的再分发义务，并在发行包中附上适用的许可证/源码获取说明。本项目代码层面不假定这些第三方二进制具有与应用相同的许可证。
