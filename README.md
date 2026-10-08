# FFmpeg 静止画面剪切器

一个面向 Windows 桌面的半自动视频剪辑工具：自动检测 MP4 中的静止画面区间，用户逐段预览确认，选择一个或多个区间删除，并导出新的 MP4。

## MVP 目标

1. 打开本地 MP4。
2. 使用 FFmpeg `freezedetect` 检测静止区间。
3. 以列表形式展示全部静止区间。
4. 点击区间后，播放器自动跳转到区间前约 0.5 秒并预览。
5. 支持单选、多选、全选待删除区间。
6. 在简化时间轴中标记静止区间与待删除区间。
7. 实时计算删除总时长和预计输出时长。
8. 使用 FFmpeg 精确重建时间轴并导出 MP4。
9. 导出过程展示进度，源文件永不修改。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- FFmpeg / ffprobe
- Zustand（状态管理）
- Vitest（单元测试）
- Playwright（关键 UI 流程测试，后续引入）

## 文档

- [系统设计](docs/系统设计.md)
- [详细设计](docs/详细设计.md)

## 核心原则

- FFmpeg 负责媒体分析和视频输出，Renderer 不直接执行系统命令。
- Electron Main Process 统一封装 ffmpeg / ffprobe 调用。
- 用户删除的是“时间区间”，源视频始终只读。
- 检测与删除解耦：自动检测只生成候选，最终删除由用户确认。
- 长视频导出优先采用 Keyframe-aware Smart Copy；非关键帧切点采用局部 GOP Smart Render；不满足安全条件时自动回退全量精确重编码。

## 建议仓库名

`ffmpeg-freeze-trimmer`
