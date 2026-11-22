// The only dependency on upstream implementation APIs. Keep profile policy here.
import * as kit from '../kit/render.mjs';

export function renderWithUpstream(source) {
  if (typeof kit.renderPage !== 'function' || typeof kit.prepareRenderedHtml !== 'function') {
    throw new Error('Upstream compatibility: kit/render.mjs must export renderPage and prepareRenderedHtml. Update software-design/upstream.mjs after upgrading upstream.');
  }
  const result = kit.renderPage(source, { models: false });
  if (!result?.kit || !Array.isArray(result.errors) || typeof result.html !== 'string') {
    throw new Error('Upstream compatibility: unexpected renderPage result; run scripts/check-software-design.mjs.');
  }
  if (result.errors.length) throw new Error(`Upstream render failed:\n${result.errors.join('\n')}`);
  let html = kit.prepareRenderedHtml(result.html);
  // The offline profile uses local CJK fonts. No behavior changes in default kit pages.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    return href && /^https:\/\/fonts\.(?:googleapis|gstatic)\.com(?:\/|$)/i.test(href) ? '' : tag;
  });
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  html = html.replace(/<head\b[^>]*>/i, (head) => `${head}\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
  return html;
}
