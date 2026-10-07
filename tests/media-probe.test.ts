// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseFfprobeOutput } from '../electron/main/media/media-probe';

describe('parseFfprobeOutput', () => {
  it('normalizes video and audio stream metadata', () => {
    const result = parseFfprobeOutput(
      'C:\\Videos\\demo.mp4',
      JSON.stringify({
        format: { duration: '125.500000' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
          },
        ],
      }),
    );

    expect(result.durationSec).toBe(125.5);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBeCloseTo(29.97, 2);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
    expect(result.hasAudio).toBe(true);
  });

  it('supports a video without an audio stream', () => {
    const result = parseFfprobeOutput(
      'C:\\Videos\\silent.mp4',
      JSON.stringify({
        format: { duration: '10' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'hevc',
            width: 1280,
            height: 720,
            r_frame_rate: '25/1',
          },
        ],
      }),
    );

    expect(result.hasAudio).toBe(false);
    expect(result.audioCodec).toBeUndefined();
    expect(result.fps).toBe(25);
  });

  it('rejects media without a video stream', () => {
    expect(() =>
      parseFfprobeOutput(
        'C:\\Videos\\audio-only.mp4',
        JSON.stringify({
          format: { duration: '10' },
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
        }),
      ),
    ).toThrow('FFPROBE_NO_VIDEO_STREAM');
  });
});
