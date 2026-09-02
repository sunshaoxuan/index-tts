import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('all product tabs share the workspace partition root', () => {
  assert.match(app, /<Tabs className=\{`workspace-tabs/);
  for (const key of ['source', 'scenes', 'roles', 'segments', 'pronunciation', 'delivery']) {
    assert.match(app, new RegExp(`key: '${key}'`));
  }
});

test('workspace, nested sections, tables and delivery captions use distinct surfaces', () => {
  assert.match(styles, /--surface-workspace:/);
  assert.match(styles, /--surface-section:/);
  assert.match(styles, /--surface-inset:/);
  assert.match(styles, /\.workspace-tabs \.ant-tabs-content > \.ant-card/);
  assert.match(styles, /\.workspace-tabs \.ant-tabs-content \.ant-card \.ant-card/);
  assert.match(styles, /\.studio-table \{[^}]*background: var\(--surface-inset\)/s);
  assert.match(styles, /\.delivery-captions \{[^}]*background:/s);
});

test('mobile keeps the partition hierarchy with reduced inset padding', () => {
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.workspace-tabs \.ant-tabs-content > \.ant-card > \.ant-card-body/);
  assert.match(styles, /padding: 18px !important/);
});

test('mobile exposes every workspace tab in a two-column navigation grid', () => {
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.workspace-tabs > \.ant-tabs-nav \.ant-tabs-nav-list/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /transform: none !important/);
  assert.match(styles, /\.ant-tabs-nav-operations,[\s\S]*\.ant-tabs-ink-bar \{ display: none; \}/);
});
