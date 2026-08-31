import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('segment table renders one composite director column with dedicated directing bands', () => {
  assert.match(app, /key: 'director-row'/);
  assert.match(app, /className="segment-row-primary"/);
  assert.match(app, /className="segment-row-secondary"/);
  assert.match(app, /className="segment-row-emotion"/);
  assert.match(app, /scroll=\{\{ y: 560 \}\}/);
  assert.doesNotMatch(app, /scroll=\{\{ x: 2260, y: 560 \}\}/);
});

test('segment rows use responsive grids and suppress horizontal table scrolling', () => {
  assert.match(styles, /\.segment-table \.ant-table-body \{ overflow-x: hidden !important; \}/);
  assert.match(styles, /\.segment-row-primary \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-row-secondary \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-row-emotion \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-source-field, \.segment-synthesis-field, \.segment-fragment-field \{ grid-column: 1 \/ -1; \}/);
  assert.match(styles, /\.segment-row-emotion \{[^}]*grid-template-columns: 170px minmax\(260px, 1fr\) 100px;/s);
  assert.match(styles, /\.segment-emotion-preview, \.segment-generation-mode-field \{ grid-column: 1 \/ -1; \}/);
});

test('segment rows expose explicit IndexTTS emotion direction detail and weight controls', () => {
  assert.match(app, />情绪演绎</);
  assert.match(app, />情绪细化描述</);
  assert.match(app, />情绪权重</);
  assert.match(app, /传入 IndexTTS 的显式情绪描述/);
  assert.match(app, /fragment \? '重新生成本分句' : '生成本分句'/);
});

test('segment rows expose stress targeting, advanced three-candidate generation, and auditable selection', () => {
  assert.match(app, />重音文字</);
  assert.match(app, />第几次出现</);
  assert.match(app, />重音强度</);
  assert.match(app, /高级三版加自主验收/);
  assert.match(app, /重音采用提示词概率增强/);
  assert.match(app, /selectSegmentCandidate/);
  assert.match(styles, /\.segment-candidate-grid/);
});

test('mobile layout suppresses nested segment scrolling and stabilizes transient messages', () => {
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /\.ant-message \{[^}]*position|\.ant-message \{/s);
  assert.match(styles, /\.segment-table \.ant-table-body \{ max-height: none !important; overflow-y: visible !important;/);
  assert.match(styles, /touch-action: pan-y pinch-zoom/);
  assert.doesNotMatch(styles, /html\.select-popup-open/);
  assert.match(app, /window\.matchMedia\('\(max-width: 800px\)'\)\.matches/);
  assert.match(app, /className="segment-field segment-generation-mode-field"><span>生成方式<\/span>/);
});

test('adjacent segment records use strong alternating surfaces and an inset secondary band', () => {
  assert.match(styles, /\.studio-table \.ant-table-cell \{[^}]*background: rgba\(16, 9, 4, \.46\)/s);
  assert.match(styles, /tr:nth-child\(even\) > \.ant-table-cell \{ background: rgba\(80, 45, 24, \.5\)/);
  assert.match(styles, /\.segment-row-secondary \{[^}]*background: rgba\(16, 9, 4, \.3\)/s);
});

test('segment labels and values remain readable at production viewport sizes', () => {
  assert.match(styles, /\.segment-field > span:first-child \{[^}]*font-size: 12px;[^}]*font-weight: 650/s);
  assert.match(styles, /\.segment-field > strong \{[^}]*font-size: 14px/s);
  assert.match(styles, /\.segment-source-field \.ant-typography \{[^}]*font-size: 14px/s);
  assert.match(styles, /\.segment-fragment-cell > \.ant-typography \{[^}]*font-size: 12px/s);
});
