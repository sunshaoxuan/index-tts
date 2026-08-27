export type FragmentAudioStatus = 'loading' | 'ready' | 'buffering' | 'error';

export function fragmentAudioRetryUrl(src: string, retry: number) {
  if (!retry) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}fragment_retry=${retry}`;
}

export function fragmentAudioErrorMessage(code?: number) {
  if (code === 1) return '音频加载已中止，请重新加载';
  if (code === 2) return '音频网络读取失败，请重新加载';
  if (code === 3) return '音频内容无法解码，请重新生成片断';
  if (code === 4) return '音频地址或格式不受支持，请重新加载';
  return '音频加载失败，请重新加载';
}

export function validFragmentAudioDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0;
}
