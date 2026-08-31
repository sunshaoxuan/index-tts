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
  assert.match(styles, /\.segment-row-secondary \{[^}]*grid-template-columns:[^}]*grid-template-areas: "source synthesis tempo pause" "fragment fragment fragment fragment";/s);
  assert.match(styles, /\.segment-row-emotion \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-fragment-field \{ grid-area: fragment;[^}]*border-top:/s);
  assert.match(styles, /\.segment-row-emotion \{[^}]*grid-template-columns: minmax\(190px, \.45fr\) minmax\(320px, 1fr\) minmax\(116px, \.28fr\);/s);
  assert.match(styles, /\.segment-emotion-preview, \.segment-generation-mode-field \{ grid-column: 1 \/ -1; \}/);
});

test('candidate audio uses the full row with three, two, and one column breakpoints', () => {
  assert.match(styles, /\.segment-candidate-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(240px, 1fr\)\);/s);
  assert.match(styles, /@media \(max-width: 1200px\) \{[^}]*\.segment-row-secondary \{[^}]*grid-template-areas: "source synthesis" "tempo pause" "fragment fragment";[^}]*\}[^}]*\.segment-candidate-grid \{ grid-template-columns: repeat\(2, minmax\(220px, 1fr\)\); \}/s);
  assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*\.segment-row-secondary \{ grid-template-areas: "source source" "synthesis synthesis" "tempo pause" "fragment fragment"; \}[\s\S]*\.segment-candidate-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
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
  assert.match(styles, /\.segment-field > span:first-child \{[^}]*font-size: 14px;[^}]*font-weight: 650/s);
  assert.match(styles, /\.segment-field > strong \{[^}]*font-size: 16px/s);
  assert.match(styles, /\.segment-source-field \.ant-typography \{[^}]*font-size: 16px/s);
  assert.match(styles, /\.segment-fragment-cell > \.ant-typography \{[^}]*font-size: 14px;[^}]*white-space: normal/s);
  assert.match(styles, /\.segment-fragment-cell \.ant-btn \{[^}]*font-size: 14px;/s);
  assert.match(styles, /\.segment-candidate \.ant-typography, \.segment-candidate small \{[^}]*font-size: 13px;/s);
  assert.match(styles, /\.segment-field :is\(\.ant-select-selector, \.ant-input-number-input, \.ant-input, textarea\) \{ font-size: 15px !important; \}/);
});
