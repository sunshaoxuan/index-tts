import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('segment table renders one composite director column with two content bands', () => {
  assert.match(app, /key: 'director-row'/);
  assert.match(app, /className="segment-row-primary"/);
  assert.match(app, /className="segment-row-secondary"/);
  assert.match(app, /scroll=\{\{ y: 560 \}\}/);
  assert.doesNotMatch(app, /scroll=\{\{ x: 2260, y: 560 \}\}/);
});

test('segment rows use responsive grids and suppress horizontal table scrolling', () => {
  assert.match(styles, /\.segment-table \.ant-table-body \{ overflow-x: hidden !important; \}/);
  assert.match(styles, /\.segment-row-primary \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-row-secondary \{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.segment-source-field, \.segment-synthesis-field, \.segment-fragment-field \{ grid-column: 1 \/ -1; \}/);
});

test('adjacent segment records use strong alternating surfaces and an inset secondary band', () => {
  assert.match(styles, /\.studio-table \.ant-table-cell \{[^}]*background: rgba\(16, 9, 4, \.46\)/s);
  assert.match(styles, /tr:nth-child\(even\) > \.ant-table-cell \{ background: rgba\(80, 45, 24, \.5\)/);
  assert.match(styles, /\.segment-row-secondary \{[^}]*background: rgba\(16, 9, 4, \.3\)/s);
});
