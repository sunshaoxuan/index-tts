import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('offers selected and all segment pace bulk actions with an all-scope confirmation', () => {
  assert.match(app, /批量设置句内节奏/);
  assert.match(app, /applyBulkSegmentPace\('selected'\)/);
  assert.match(app, /applyBulkSegmentPace\('all'\)/);
  assert.match(app, /将全部 \$\{project\.segments\.length\} 条分句改为/);
  assert.match(app, /相关片断缓存和完整交付会按现有规则失效/);
});

test('explains slow pace behavior and keeps bulk controls usable on narrow screens', () => {
  assert.match(app, /“舒缓”会对目标分句应用慢速提示和 1\.18 时长系数/);
  assert.match(styles, /\.segment-bulk-pace > \.ant-select \{ width: 190px; \}/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.segment-bulk-pace[\s\S]*width: 100%/);
});
