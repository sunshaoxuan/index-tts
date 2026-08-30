export type DeliveryAudioStatus = 'loading' | 'ready' | 'buffering' | 'playing' | 'paused' | 'error';

export function deliveryAudioRetryUrl(src: string, retry: number) {
  if (!retry) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}delivery_retry=${retry}`;
}

export function deliveryAudioBufferedPercent(duration: number, bufferedEnd: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(bufferedEnd) || bufferedEnd <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(bufferedEnd / duration * 100)));
}

export function deliveryAudioErrorMessage(code?: number) {
  if (code === 1) return '完整音频加载已中止，请重新加载';
  if (code === 2) return '网络读取完整音频失败，请检查网络后重新加载';
  if (code === 3) return '完整音频无法解码，请检查交付文件';
  if (code === 4) return '完整音频地址或格式不可用，请重新加载';
  return '完整音频加载失败，请重新加载';
}
