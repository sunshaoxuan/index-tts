import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('offers supported reference audio formats and previews the registered voice', () => {
  assert.match(app, /accept="\.wav,\.mp3,\.flac,\.m4a,\.aac,\.ogg,audio\/wav,audio\/mpeg,audio\/flac,audio\/mp4,audio\/aac,audio\/ogg"/);
  assert.match(app, /await api\.uploadRoleReferenceAudio\(project\.project_id, roleDraft\[0\], file\)/);
  assert.match(app, /reference_audio: \{[\s\S]*voice_id: result\.voiceId/);
  assert.match(app, /<VoicePreview voiceId=\{roleAssetDraft\.reference_audio\.voice_id\}/);
});

test('locks the role editor while reference audio is uploading', () => {
  assert.match(app, /const projectLocked = [^;]*referenceAudioUploading[^;]*standardReferenceSaving/);
  assert.match(app, /confirmLoading=\{referenceAudioUploading \|\| Boolean\(standardReferenceSaving\)\}/);
  assert.match(app, /closable=\{!projectLocked\}/);
  assert.match(app, /keyboard=\{!projectLocked\}/);
  assert.match(app, /maskClosable=\{!projectLocked\}/);
  assert.match(app, /cancelButtonProps=\{\{ disabled: projectLocked \}\}/);
  assert.match(app, /onCancel=\{\(\) => \{ if \(projectLocked\) return;/);
  assert.match(app, /处理完成前角色卡片保持锁定，请等待明确结果/);
});
