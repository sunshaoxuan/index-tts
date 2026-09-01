import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('segment table renders one composite director column with basic and voice bands', () => {
  assert.match(app, /key: 'director-row'/);
  assert.match(app, /className="segment-row-primary"/);
  assert.match(app, /className="segment-row-voice"/);
  assert.doesNotMatch(app, /className="segment-row-secondary"/);
  assert.doesNotMatch(app, /className="segment-row-emotion"/);
  assert.match(app, /scroll=\{\{ y: 560 \}\}/);
  assert.doesNotMatch(app, /scroll=\{\{ x: 2260, y: 560 \}\}/);
  assert.match(app, /segmentTableBodyHeight\(window\.innerHeight, host\.getBoundingClientRect\(\)\.top\)/);
  assert.match(app, /window\.requestAnimationFrame\(measure\)/);
  assert.match(app, /if \(!host\) return;/);
  assert.match(app, /observer\.observe\(host\)/);
  assert.match(app, /window\.addEventListener\('scroll', scheduleMeasure, \{ passive: true \}\)/);
  assert.match(app, /window\.removeEventListener\('scroll', scheduleMeasure\)/);
  assert.match(app, /--segment-table-body-height/);
  assert.match(styles, /max-height: var\(--segment-table-body-height, 560px\) !important;/);
});

test('segment rows keep basic copy above a compact voice control grid', () => {
  assert.match(styles, /\.segment-table \.ant-table-body \{[^}]*overflow-x: hidden !important; \}/s);
  assert.match(styles, /\.segment-row-primary \{[^}]*grid-template-columns: 56px 88px minmax\(260px, \.85fr\) minmax\(320px, 1\.15fr\);/s);
  assert.match(styles, /\.segment-row-voice \{[\s\S]*grid-template-areas:[\s\S]*"action role language attitude emotion pace pause direction weight"[\s\S]*"action detail detail detail stress occurrence level generation generation"/);
  assert.match(app, /className="segment-field segment-source-field"[\s\S]*className="segment-field segment-synthesis-field"[\s\S]*className="segment-row-voice"/);
  assert.match(app, /className=\{`segment-action-cell[\s\S]*segment-role-field/);
});

test('candidate audio uses the full row with three, two, and one column breakpoints', () => {
  assert.match(styles, /\.segment-candidate-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(240px, 1fr\)\);/s);
  assert.match(styles, /@media \(max-width: 1200px\) \{[\s\S]*\.segment-candidate-grid \{ grid-template-columns: repeat\(2, minmax\(220px, 1fr\)\); \}/);
  assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*\.segment-candidate-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test('segment rows expose explicit IndexTTS emotion direction detail and weight controls', () => {
  assert.match(app, />情绪演绎</);
  assert.match(app, />情绪细化描述</);
  assert.match(app, />情绪权重</);
  assert.match(app, />本次有效导演参数</);
  assert.match(app, /fragment \? '重新生成' : '生成'/);
});

test('fragment action cell uses compact playback and leaves no empty player placeholder', () => {
  assert.match(app, /fragment && <FragmentAudioPlayer compact variant="primary" src=\{fragmentAudioSelectionUrl/);
  assert.match(app, /fragment \? ' has-fragment' : ' no-fragment'/);
  assert.doesNotMatch(app, /尚无与当前序号对应的片断/);
  assert.match(styles, /\.fragment-audio-player audio \{ display: none; \}/);
  assert.match(styles, /\.fragment-audio-compact-controls \{[^}]*grid-template-columns: 30px minmax\(0, 1fr\) 30px;/s);
  assert.match(app, /title="重新加载片断" aria-label="重新加载片断"/);
});

test('adopting a candidate changes the primary media identity and exposes colored playback states', () => {
  assert.match(app, /fragment\.candidates\?\.find\(candidate => candidate\.selected\)\?\.candidateId/);
  assert.match(app, /segmentCandidateSelectionRef/);
  assert.match(app, /loading=\{selecting\}/);
  assert.match(styles, /\.fragment-audio-primary \{ --fragment-audio-accent: #48c7ff;/);
  assert.match(styles, /\.fragment-audio-candidate \{ --fragment-audio-accent: #aa8cff;/);
  assert.match(styles, /\.fragment-audio-loading, \.fragment-audio-buffering \{ --fragment-audio-accent: #f2be5c;/);
  assert.match(styles, /\.fragment-audio-playback-playing \{ --fragment-audio-accent: #45bfff;/);
  assert.match(styles, /\.fragment-audio-playback-paused \{ --fragment-audio-accent: #bd91ff;/);
  assert.match(styles, /\.fragment-audio-playback-ended \{ --fragment-audio-accent: #82d66f;/);
  assert.match(styles, /\.fragment-audio-error \{ --fragment-audio-accent: #ff7188;/);
});

test('segment rows expose stress targeting, advanced three-candidate generation, and auditable selection', () => {
  assert.match(app, />重音文字</);
  assert.match(app, />第几次出现</);
  assert.match(app, />重音强度</);
  assert.match(app, /高级三版加音色门禁/);
  assert.match(app, /本次有效导演参数/);
  assert.match(app, /音色相似度/);
  assert.match(app, /最终效果以人工试听为准/);
  assert.match(app, /人工采用此版/);
  assert.doesNotMatch(app, /!candidate\.qualityPassed \|\| Boolean\(segmentCandidateSelection\)/);
  assert.match(app, /重音为概率增强/);
  assert.match(app, /selectSegmentCandidate/);
  assert.match(styles, /\.segment-candidate-grid/);
});

test('mobile layout suppresses nested segment scrolling and stabilizes transient messages', () => {
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /\.ant-message \{[^}]*inset-inline: 12px !important;[^}]*top: max\(64px, calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)\) !important;[^}]*width: auto !important;[^}]*transform: none !important;/s);
  assert.match(styles, /\.ant-message \.ant-message-notice-wrapper \{ display: flex; justify-content: center; \}/);
  assert.match(styles, /\.segment-table \.ant-table-body \{ max-height: none !important; overflow-y: visible !important;/);
  assert.match(styles, /touch-action: pan-y pinch-zoom/);
  assert.doesNotMatch(styles, /html\.select-popup-open/);
  assert.match(app, /window\.matchMedia\('\(max-width: 800px\)'\)\.matches/);
  assert.match(app, /className="segment-field segment-generation-mode-field"><span>生成方式<\/span>/);
  assert.match(styles, /"generation generation"/);
});

test('adjacent segment records use strong alternating surfaces and an inset voice band', () => {
  assert.match(styles, /\.studio-table \.ant-table-cell \{[^}]*background: rgba\(16, 9, 4, \.46\)/s);
  assert.match(styles, /tr:nth-child\(even\) > \.ant-table-cell \{ background: rgba\(80, 45, 24, \.5\)/);
  assert.match(styles, /\.segment-row-voice \{[\s\S]*background: rgba\(16, 9, 4, \.3\)/s);
});

test('segment labels and values remain readable at production viewport sizes', () => {
  assert.match(styles, /\.segment-field > span:first-child \{[^}]*font-size: 12px;[^}]*font-weight: 650/s);
  assert.match(styles, /\.segment-field > strong \{[^}]*font-size: 14px/s);
  assert.match(styles, /\.segment-source-field \.ant-typography \{[^}]*font-size: 14px/s);
  assert.match(styles, /\.segment-candidate \.ant-typography, \.segment-candidate small \{[^}]*font-size: 13px;/s);
  assert.match(styles, /\.segment-field :is\(\.ant-select-selector, \.ant-input-number-input, \.ant-input, textarea\) \{ font-size: 13px !important; \}/);
});
