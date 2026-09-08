import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('offers all common director fields with selected and all-scope actions', () => {
  assert.match(app, /批量修改导演参数/);
  for (const field of ['角色', '语言', '态度', '情绪', '句内节奏', '停顿', '情绪演绎', '情绪权重', '生成方式']) assert.match(app, new RegExp(`label: '${field}'`));
  assert.match(app, /applyBulkSegmentEdit\('selected'\)/);
  assert.match(app, /applyBulkSegmentEdit\('all'\)/);
  assert.match(app, /应用到全部 \$\{project\.segments\.length\} 条分句/);
  assert.match(app, /相关片断缓存和完整交付会按现有规则失效/);
});

test('uses value-specific controls and keeps bulk controls usable on narrow screens', () => {
  assert.match(app, /\['pause', 'emotionWeight'\]\.includes\(bulkSegmentField\)/);
  assert.match(app, /“舒缓”会应用慢速提示和 1\.18 时长系数/);
  assert.match(app, /逐句文字、情绪细化与重音仍在行内设置/);
  assert.match(styles, /\.segment-bulk-director \{[\s\S]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.segment-bulk-director \{ grid-template-columns: 1fr 1fr/);
});
