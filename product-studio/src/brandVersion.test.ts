import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('shows the runtime product version beside the product name', () => {
  assert.match(app, /className="brand-title-row"[\s\S]*Index Voice Studio[\s\S]*className="brand-version">v\{runtimeHealth\?\.productVersion/);
  assert.match(styles, /\.brand-title-row \{[^}]*display: flex;[^}]*align-items: baseline;/s);
  assert.match(styles, /\.studio-header \.brand-version \{[^}]*font-size: 8px;/s);
});
