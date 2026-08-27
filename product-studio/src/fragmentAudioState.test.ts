import assert from 'node:assert/strict';
import test from 'node:test';
import { fragmentAudioErrorMessage, fragmentAudioRetryUrl, validFragmentAudioDuration } from './fragmentAudioState.ts';

test('adds a cache-busting retry parameter to fragment audio URLs', () => {
  assert.equal(fragmentAudioRetryUrl('/audio.wav', 0), '/audio.wav');
  assert.equal(fragmentAudioRetryUrl('/audio.wav', 2), '/audio.wav?fragment_retry=2');
  assert.equal(fragmentAudioRetryUrl('/audio.wav?source=cache', 3), '/audio.wav?source=cache&fragment_retry=3');
});

test('describes media failures and rejects invalid duration', () => {
  assert.equal(fragmentAudioErrorMessage(2), '音频网络读取失败，请重新加载');
  assert.equal(fragmentAudioErrorMessage(3), '音频内容无法解码，请重新生成片断');
  assert.equal(validFragmentAudioDuration(1.25), true);
  assert.equal(validFragmentAudioDuration(0), false);
  assert.equal(validFragmentAudioDuration(Number.NaN), false);
});
