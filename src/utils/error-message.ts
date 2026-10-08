const ERROR_MESSAGES: Record<string, string> = {
  FILE_NOT_FOUND: '找不到视频文件，请确认文件仍然存在。',
  UNSUPPORTED_MEDIA: '当前只支持 MP4 视频文件。',
  FFPROBE_FAILED: '无法读取视频媒体信息，请确认 FFmpeg/ffprobe 可用且文件未损坏。',
  FFPROBE_INVALID_JSON: '媒体信息解析失败。',
  FFPROBE_NO_VIDEO_STREAM: '文件中没有可用的视频轨道。',
  FFPROBE_INVALID_DURATION: '无法读取有效的视频时长。',
  FREEZE_DETECTION_FAILED: '静止画面检测失败，请检查 FFmpeg 是否可用。',
  INVALID_DETECTION_OPTIONS: '静止检测参数无效。',
  INVALID_MEDIA_DURATION: '视频时长无效。',
  INVALID_DETECTION_RANGE: '检测起点、方向或数量无效。',
  EXACT_FRAME_SCAN_FAILED: '当前画面精确定位失败。',
  SILENCE_DETECTION_FAILED: '音频有声/无声区间分析失败。',
  INVALID_RANGE: '检测到无效的时间区间。',
  NO_KEEP_RANGE: '当前选择会删除整个视频，请至少保留一段内容。',
  OUTPUT_CANNOT_OVERWRITE_SOURCE: '导出路径不能与源视频相同。',
  OUTPUT_MUST_BE_MP4: '导出文件必须使用 .mp4 扩展名。',
  EXPORT_ALREADY_RUNNING: '已有导出任务正在进行。',
  EXPORT_EMPTY_OUTPUT: '导出结果为空，请检查输入文件和裁剪区间。',
  EXPORT_FAILED: '视频导出失败。',
  PROCESS_START_FAILED: '无法启动底层媒体处理程序。',
  PROCESS_ABORTED: '任务已取消。',
};

export function getUserFriendlyError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  const code = raw.trim();
  if (ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }

  if (code.includes('No such file or directory')) {
    return ERROR_MESSAGES.FILE_NOT_FOUND;
  }

  if (code.toLowerCase().includes('invalid data found')) {
    return '视频文件无法解析，可能已损坏或格式不受支持。';
  }

  return code || fallback;
}
