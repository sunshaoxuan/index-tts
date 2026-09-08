import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('edits the current project title through the existing save workflow', () => {
  assert.match(app, /aria-label="工程名称"[\s\S]*value=\{project\?\.title \|\| ''\}[\s\S]*patchProject\('title', event\.target\.value\)/);
  assert.match(app, /aria-label="工程名称" disabled=\{projectLocked \|\| saving \|\| !project\}/);
  assert.match(app, /maxLength=\{120\}/);
  assert.match(app, /label: `\$\{savedProject\.title\}  \$\{savedProject\.project_id\}`/);
});

test('keeps project selection and title editing responsive', () => {
  assert.match(styles, /\.project-identity-fields \{[^}]*grid-template-columns: minmax\(280px, 1\.15fr\) minmax\(240px, 1fr\)/s);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.project-identity-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
