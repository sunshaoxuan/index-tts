import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { segmentAccentGuidance } from './segmentAccentGuidance.ts';

test('detects regional accent instructions entered as segment emotion detail', () => {
  assert.equal(segmentAccentGuidance('成都口音'), '成都口音');
  assert.equal(segmentAccentGuidance('请用四川话来读'), '请用四川话来读');
  assert.equal(segmentAccentGuidance('slightly teasing, with a British accent'), 'slightly teasing, with a British accent');
});

test('keeps actual emotion and delivery details in the segment editor', () => {
  assert.equal(segmentAccentGuidance('笑意压在句尾，略带迟疑'), undefined);
  assert.equal(segmentAccentGuidance('带一点哭腔'), undefined);
});

test('keeps the role accent entry visible and routes misplaced segment guidance to it', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  assert.match(app, /className="voice-accent-control"/);
  assert.match(app, />地域或口音</);
  assert.match(app, /asset\.voice_traits\.accent \|\| '标准口音'/);
  assert.match(app, /segmentAccentGuidance\(segment\?\.\[13\]\)/);
  assert.match(app, /移到\{row\[3\]\}的口音/);
  assert.match(app, /setSegmentAccentMigration/);
  assert.match(styles, /\.voice-accent-control \{/);
  assert.match(styles, /\.segment-accent-routing \{/);
});
