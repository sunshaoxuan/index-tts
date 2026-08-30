import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryAudioBufferedPercent, deliveryAudioErrorMessage, deliveryAudioRetryUrl } from './deliveryAudioState.ts';

test('calculates bounded whole-number delivery audio buffer progress', () => {
  assert.equal(deliveryAudioBufferedPercent(100, 25.4), 25);
  assert.equal(deliveryAudioBufferedPercent(100, 120), 100);
  assert.equal(deliveryAudioBufferedPercent(100, -1), 0);
  assert.equal(deliveryAudioBufferedPercent(0, 10), 0);
  assert.equal(deliveryAudioBufferedPercent(Number.NaN, 10), 0);
});

test('adds a cache-busting delivery retry and describes network failure', () => {
  assert.equal(deliveryAudioRetryUrl('/audio.wav', 0), '/audio.wav');
  assert.equal(deliveryAudioRetryUrl('/audio.wav', 2), '/audio.wav?delivery_retry=2');
  assert.equal(deliveryAudioRetryUrl('/audio.wav?source=latest', 3), '/audio.wav?source=latest&delivery_retry=3');
  assert.equal(deliveryAudioErrorMessage(2), '网络读取完整音频失败，请检查网络后重新加载');
  assert.equal(deliveryAudioErrorMessage(3), '完整音频无法解码，请检查交付文件');
});
