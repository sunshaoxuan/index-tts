import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const debugPort = Number(process.argv[2] || 9333);
const outputDir = resolve(process.argv[3] || '.');
const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json());
const target = pages.find(page => page.type === 'page');
if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', rejectOpen, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleIssues = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: resolveCall, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolveCall(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleIssues.push({ type: 'exception', text: message.params.exceptionDetails?.text || '' });
  }
  if (message.method === 'Log.entryAdded' && ['warning', 'error'].includes(message.params.entry?.level)) {
    consoleIssues.push({ type: message.params.entry.level, text: message.params.entry.text });
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(message.params.type)) {
    consoleIssues.push({ type: message.params.type, text: message.params.args?.map(item => item.value ?? item.description ?? '').join(' ') });
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveCall, reject) => {
    pending.set(id, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result?.value;
}

async function waitFor(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function acceptViewport(name, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Page.navigate', { url: 'http://127.0.0.1:7864/' });
  await waitFor(`document.body?.innerText.includes('成都粉子02') && document.querySelectorAll('[role="tab"]').length >= 6`);
  await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).find(el => el.textContent.includes('角色资产'))?.click()`);
  await waitFor(`document.body?.innerText.includes('角色资产卡片') && Array.from(document.querySelectorAll('.character-card')).some(el => el.textContent.includes('旁白') && el.textContent.includes('成都口音'))`);
  await evaluate(`Array.from(document.querySelectorAll('.character-card')).find(el => el.textContent.includes('旁白'))?.click()`);
  await waitFor(`Array.from(document.querySelectorAll('input')).some(el => el.placeholder?.includes('成都口音') && el.value === '成都口音')`);
  const metrics = await evaluate(`(() => {
    const input = Array.from(document.querySelectorAll('input')).find(el => el.placeholder?.includes('成都口音'));
    input.scrollIntoView({ block: 'center' });
    const modal = input.closest('.ant-modal');
    const visibleOverflow = Array.from(document.querySelectorAll('body *')).filter(el => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).slice(0, 10).map(el => ({ tag: el.tagName, className: String(el.className).slice(0, 120), text: String(el.textContent || '').trim().slice(0, 80), rect: el.getBoundingClientRect().toJSON() }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      accentValue: input.value,
      accentVisible: Boolean(input.offsetWidth && input.offsetHeight),
      inputRect: input.getBoundingClientRect().toJSON(),
      modalRect: modal?.getBoundingClientRect().toJSON(),
      visibleOverflow,
    };
  })()`);
  await new Promise(resolveWait => setTimeout(resolveWait, 150));
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  return metrics;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
const desktop = await acceptViewport('desktop-role-accent', 1280, 900);
const mobile = await acceptViewport('mobile-role-accent', 390, 844);
const result = { desktop, mobile, consoleIssues };
await writeFile(resolve(outputDir, 'browser-acceptance.json'), JSON.stringify(result, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await send('Browser.close');
