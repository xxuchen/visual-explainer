import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profile = 'software-design/chat-preview/v1';
const maxWidth = 1400, maxHeight = 1200;
const priority = ['flow', 'context', 'state', 'sequence', 'er'];
const rank = (type) => priority.includes(type) ? priority.indexOf(type) : priority.length;
const figureWidth = (width) => Math.max(440, Math.ceil(width) + 44);

export function previewEligibility(report, html) {
  if (report?.profile !== 'software-design/v1' || report.htmlSha256 !== hash(html))
    return 'The report does not match the current HTML. Render again.';
  if (!report.ok || report.design?.status !== 'passed' || report.static?.status !== 'passed' || report.browser?.status !== 'passed')
    return 'Design, static HTML and browser checks must pass before generating chat previews.';
  return html.includes('data-sd-profile="1"') ? '' : 'Invalid software-design HTML.';
}

export function chooseDiagrams(items) {
  return [...items].filter((item) => Number.isFinite(item.width) && Number.isFinite(item.height) && item.width > 0 && item.height > 0 &&
    figureWidth(item.width) <= maxWidth && item.height + 80 <= maxHeight)
    .sort((a, b) => rank(a.type) - rank(b.type));
}

// Keep a drive-letter absolute path on Windows, rather than file://, a leading
// slash before the drive letter, or an angle-bracket destination. Escape Markdown
// path delimiters. Some host versions still require the accompanying file link.
export function markdownImage(path, kind) {
  const url = path.replace(/\\/g, '/').replace(/[%\s#?()[\]<>]/gu, (char) => encodeURIComponent(char).replace(/[()]/g, (c) => c === '(' ? '%28' : '%29'));
  return '![' + (kind === 'overview' ? '方案摘要' : '关键设计图') + '](' + url + ')';
}

// Resolve the same optional dependencies as the existing browser inspector.
// This module deliberately does not modify the renderer or the check report.
function resolvePlaywright() {
  const resolvers = [createRequire(import.meta.url)];
  for (const dir of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean))
    resolvers.push(createRequire(join(resolve(dir), '__sd_preview__.cjs')));
  for (const resolver of resolvers) for (const name of ['playwright', 'playwright-core']) {
    try { return resolver(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  return null;
}

async function saveImage(locator, dir, kind, title, diagramId) {
  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1 || box.width > maxWidth || box.height > maxHeight) return null;
  const png = await locator.screenshot({ animations: 'disabled', scale: 'css', timeout: 10000 });
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (width > maxWidth || height > maxHeight) return null;
  const digest = hash(png);
  const file = join(dir, 'chat-' + kind + '-' + digest.slice(0, 24) + '.png');
  // Never overwrite an unrelated file. The content-addressed name also avoids
  // stale image caches after a proposal revision.
  try { await writeFile(file, png, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || hash(await readFile(file)) !== digest) throw error;
  }
  return { kind, title, ...(diagramId ? { diagramId } : {}), path: file, sha256: digest,
    width, height, markdown: markdownImage(file, kind) };
}

export async function generateChatPreview(input, { executablePath } = {}) {
  const absolute = resolve(input);
  const html = await readFile(absolute, 'utf8');
  const base = { profile, html: absolute, htmlSha256: hash(html), images: [] };
  let report;
  try { report = JSON.parse(await readFile(absolute + '.checks.json', 'utf8')); }
  catch (error) { return { ...base, status: 'skipped', reason: 'Missing or unreadable check report: ' + error.message }; }
  const reason = previewEligibility(report, html);
  if (reason) return { ...base, status: 'skipped', reason };
  let browser;
  try {
    const playwright = resolvePlaywright();
    if (!playwright?.chromium) return { ...base, status: 'skipped', reason: 'Playwright unavailable.' };
    browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  } catch (error) { return { ...base, status: 'skipped', reason: error.message }; }
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', offline: true });
    const blocked = new Set(), errors = [];
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^(data:|blob:|about:)/i.test(url)) await route.continue();
      else { blocked.add(url); await route.abort(); }
    });
    if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', (socket) => { blocked.add(socket.url()); socket.close(); });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    // Use the exact checked bytes rather than navigating to a changing file.
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => document.documentElement.dataset.sdReady === 'ready', undefined, { timeout: 8000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    // Make room for a full-width diagram without horizontal viewport clipping.
    await page.locator('.sd-main').evaluate((element) => {
      element.style.cssText += ';max-width:none;width:100%;box-sizing:border-box;padding:20px 24px';
    });
    const dir = absolute + '.screenshots';
    await mkdir(dir, { recursive: true });
    const header = page.locator('.sd-main > header');
    // All mutations are confined to this temporary browser page; the original
    // HTML and its verification evidence are not changed.
    await header.evaluate((element) => {
      element.querySelectorAll('nav, details').forEach((node) => node.remove());
      element.style.cssText += ';width:860px;max-width:100%;box-sizing:border-box;padding:24px;background:#f3f6f7';
      const stats = element.querySelector('.sd-stats');
      if (stats) stats.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    });
    const images = [];
    const overview = await saveImage(header, dir, 'overview', '方案摘要');
    if (overview) images.push(overview);
    const all = await page.locator('figure[data-sd-diagram]').evaluateAll((figures) => figures.map((figure, index) => {
      const box = figure.querySelector('svg')?.getBoundingClientRect();
      return { index, id: figure.id, type: figure.dataset.sdDiagram, title: figure.querySelector('figcaption strong')?.textContent || figure.id, width: box?.width || 0, height: box?.height || 0 };
    }));
    const selectedTypes = new Set();
    for (const item of chooseDiagrams(all)) {
      if (selectedTypes.size >= 2) break;
      if (selectedTypes.has(item.type)) continue;
      const figure = page.locator('figure[data-sd-diagram]').nth(item.index);
      const fits = await figure.evaluate((element, width) => {
        element.style.cssText += ';width:' + width + 'px;max-width:none;box-sizing:border-box';
        const scroll = element.querySelector('.sd-diagram-scroll');
        if (!scroll) return false;
        scroll.scrollLeft = 0;
        return scroll.scrollWidth <= scroll.clientWidth + 2 && element.scrollWidth <= element.clientWidth + 2;
      }, figureWidth(item.width));
      if (!fits) continue;
      const image = await saveImage(figure, dir, 'diagram', item.title, item.id);
      if (image) { images.push(image); selectedTypes.add(item.type); }
    }
    if (blocked.size || errors.length) return { ...base, status: 'failed', reason: 'Preview encountered external requests or JavaScript errors.', errors: [...errors, ...blocked] };
    if (hash(await readFile(absolute, 'utf8')) !== base.htmlSha256) return { ...base, status: 'skipped', reason: 'HTML changed during preview. Render again.' };
    const status = images.length ? (overview && (!all.length || selectedTypes.size) ? 'generated' : 'partial') : 'skipped';
    return { ...base, images, status, omittedDiagrams: all.length - selectedTypes.size,
      ...(status === 'generated' ? {} : { reason: 'Some or all sections exceed preview limits; use the complete HTML.' }) };
  } catch (error) { return { ...base, status: 'failed', reason: error.message }; }
  finally { await browser.close(); }
}

let direct = false;
try { direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch {}
if (direct) {
  try {
    const [input, flag, executablePath, ...rest] = process.argv.slice(2);
    if (!input || rest.length || (flag && (flag !== '--browser-executable' || !executablePath))) throw new Error('Usage: node chat-preview.mjs <page.html> [--browser-executable <path>]');
    const result = await generateChatPreview(input, { executablePath });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } catch (error) { console.error('Chat preview: ' + error.message); process.exitCode = 1; }
}
