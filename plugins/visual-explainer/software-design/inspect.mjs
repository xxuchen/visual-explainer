import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { reviewDiagrams, reviewTextLength, REVIEW_LIMIT } from "./review.mjs";
import { businessRows, renderBusinessRows } from "./business-flow.mjs";

const COLLECTIONS = ["terms", "components", "requirements", "rules", "data", "states", "transitions", "apis", "diagrams", "acceptance", "decisions", "risks", "quality"];
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = new Set(["script", "style", "textarea", "title"]);
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (value) => String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
  if (key[0] !== "#") return ENTITY[key.toLowerCase()] ?? whole;
  const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
});

// A tokenizer for this profile's generated HTML, not an HTML sanitizer or a general
// browser parser. Raw-text blocks are skipped so JS strings cannot create fake IDs.
function tokenize(html) {
  const nodes = [], stack = [];
  let at = 0;
  while (at < html.length) {
    const start = html.indexOf("<", at);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    let end = start + 1, quote = "";
    for (; end < html.length; end++) {
      const c = html[end];
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end === html.length) break;
    at = end + 1;
    const raw = html.slice(start + 1, end);
    const head = raw.match(/^\s*(\/?)\s*([a-z][\w:-]*)/i);
    if (!head) continue;
    const name = head[2].toLowerCase();
    if (head[1]) {
      const i = stack.findLastIndex((n) => n.name === name);
      if (i >= 0) stack.splice(i);
      continue;
    }
    const attrs = {};
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const body = raw.slice(head[0].length).replace(/\/\s*$/, "");
    let a;
    while ((a = pattern.exec(body))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    const node = { name, attrs, parent: stack.at(-1), raw: "" };
    nodes.push(node);
    if (RAW.has(name)) {
      const closing = new RegExp(`</${name}\\s*>`, "ig");
      closing.lastIndex = at;
      const match = closing.exec(html);
      node.raw = html.slice(at, match?.index ?? html.length);
      at = match ? closing.lastIndex : html.length;
    } else if (!VOID.has(name) && !/\/\s*$/.test(raw)) stack.push(node);
  }
  return nodes;
}

const inside = (node, ancestor) => {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};
const cssDecode = (value) => value.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char);
const localResource = (value) => /^(?:data:|blob:|#)/i.test(value.trim());
const location = (n) => `<${n.name}${n.attrs.id ? `#${n.attrs.id}` : ""}>`;

/** Static checks for the generated profile. Dynamic JS and layout need inspectBrowser. */
export function inspectHtml(html, { spec } = {}) {
  const errors = [], warnings = [];
  const error = (code, message) => errors.push({ code, message });
  if (typeof html !== "string" || !html.trim()) return { ok: false, errors: [{ code: "HTML_EMPTY", message: "HTML is empty." }], warnings };
  const nodes = tokenize(html), ids = new Map();
  const roots = nodes.filter((n) => n.name === "html");
  if (roots.length !== 1) error("HTML_ROOT", "Expected exactly one html element.");
  if (!/^zh(?:-CN)?$/i.test(roots[0]?.attrs.lang ?? "")) error("HTML_LANGUAGE", "Chinese design pages require lang=\"zh-CN\".");
  if (!nodes.some((n) => n.name === "meta" && /^utf-?8$/i.test(n.attrs.charset ?? ""))) error("HTML_CHARSET", "Declare UTF-8 explicitly.");
  if (!nodes.some((n) => n.name === "meta" && n.attrs.name?.toLowerCase() === "viewport")) error("HTML_VIEWPORT", "Declare a responsive viewport.");
  for (const node of nodes) {
    if (Object.hasOwn(node.attrs, "id")) {
      const id = node.attrs.id;
      if (!id || /\s/.test(id)) error("HTML_ID", `${location(node)} has an empty or whitespace-containing ID.`);
      if (ids.has(id)) error("DUPLICATE_ID", `Duplicate HTML ID: ${id}.`);
      else ids.set(id, node);
    }
  }
  const fragment = (value, where) => {
    if (!value.startsWith("#") || value === "#") return;
    let id;
    try { id = decodeURIComponent(value.slice(1)); } catch { error("ANCHOR_ENCODING", `${where}: invalid fragment encoding.`); return; }
    if (!ids.has(id)) error("MISSING_ANCHOR", `${where} refers to missing #${id}.`);
  };
  const resource = (value, where) => {
    if (!localResource(value)) error("EXTERNAL_RESOURCE", `${where} depends on a non-embedded resource: ${value || "(empty)"}.`);
    else fragment(value.trim(), where);
  };
  const css = (source, where) => {
    const clean = cssDecode(source.replace(/\/\*[\s\S]*?\*\//g, ""));
    const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
    let match;
    while ((match = urls.exec(clean))) resource((match[1] ?? match[2] ?? match[3]).trim(), `${where} CSS url()`);
    const imports = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
    while ((match = imports.exec(clean))) resource(match[1] ?? match[2], `${where} CSS @import`);
  };
  for (const node of nodes) {
    const a = node.attrs, where = location(node);
    for (const key of ["href", "xlink:href"]) if (a[key]?.startsWith("#")) fragment(a[key], where);
    for (const key of ["aria-labelledby", "aria-describedby"]) {
      for (const id of (a[key] ?? "").split(/\s+/).filter(Boolean)) fragment(`#${id}`, `${where} ${key}`);
    }
    if (a.style) css(a.style, where);
    for (const key of ["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]) if (a[key]) css(a[key], `${where} ${key}`);
    if (node.name === "style") css(node.raw, where);
    if (node.name === "base") error("HTML_BASE", "A base element changes offline resource and anchor resolution.");
    if (["iframe", "object", "embed"].includes(node.name)) error("EMBEDDED_DOCUMENT", `${where} is outside the self-contained profile; render its content inline.`);
    if (node.name === "link" && /(?:^|\s)(?:stylesheet|preload|modulepreload|preconnect|dns-prefetch|icon|manifest)(?:\s|$)/i.test(a.rel ?? "")) resource(a.href ?? "", where);
    if (["script", "img", "source", "audio", "video", "track", "input"].includes(node.name) && Object.hasOwn(a, "src")) resource(a.src, `${where} src`);
    if (node.name === "video" && a.poster) resource(a.poster, `${where} poster`);
    if (["image", "use", "feimage"].includes(node.name)) for (const key of ["href", "xlink:href"]) if (Object.hasOwn(a, key)) resource(a[key], `${where} ${key}`);
    if (a.srcset) {
      // Generated pages have no srcset. Inspect ordinary candidates; require an
      // explicit single data URL to avoid ambiguous commas in a data URI list.
      if (/^data:/i.test(a.srcset.trim()) && !/\s[\d.]+[wx]\s*,/i.test(a.srcset)) resource(a.srcset.trim(), `${where} srcset`);
      else for (const candidate of a.srcset.split(",")) resource(candidate.trim().split(/\s+/)[0], `${where} srcset`);
    }
    if (node.name === "script" && !/^(?:application\/json|application\/ld\+json)$/i.test(a.type ?? "")) {
      // This catches literal requests. Browser interception is still necessary
      // for dynamic URLs and resources inserted by arbitrary JS.
      const requests = /\b(?:fetch|import|WebSocket|EventSource|Worker|SharedWorker)\s*\(\s*(["'`])([^"'`]+)\1/g;
      let match;
      while ((match = requests.exec(node.raw))) resource(match[2], `${where} JavaScript request`);
      const imports = /\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/g;
      while ((match = imports.exec(node.raw))) resource(match[1], `${where} JavaScript import`);
    }
  }
  const figures = nodes.filter((n) => n.name === "figure" && Object.hasOwn(n.attrs, "data-sd-diagram"));
  for (const figure of figures) {
    const drawings = nodes.filter((n) => n.name === "svg" && inside(n, figure));
    if (drawings.length !== 1) error("DIAGRAM_SVG", `${location(figure)} must contain exactly one SVG.`);
  }
  for (const svg of nodes.filter((n) => n.name === "svg" && n.attrs["aria-hidden"] !== "true")) {
    const title = nodes.some((n) => n.name === "title" && inside(n, svg) && decode(n.raw).trim());
    if (!svg.attrs["aria-label"]?.trim() && !svg.attrs["aria-labelledby"]?.trim() && !title) error("SVG_ACCESSIBILITY", `${location(svg)} needs an accessible title.`);
    const box = (svg.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) error("SVG_VIEWBOX", `${location(svg)} needs a positive finite viewBox.`);
  }
  const compact = roots[0]?.attrs["data-sd-view"] === "compact";
  if (spec?.businessFlow) {
    if (roots[0]?.attrs["data-sd-logic"] !== "1") error("LOGIC_PROFILE","Business-flow page marker is missing.");
    const actual = nodes.filter(n=>Object.hasOwn(n.attrs,"data-sd-scenario")).map(n=>n.attrs["data-sd-scenario"]);
    const expected = businessRows(spec,{compact}).map(r=>r.id);
    if (JSON.stringify(actual)!==JSON.stringify(expected)) error("LOGIC_SCENARIOS","Visible business paths differ from the source.");
    if (!html.includes(renderBusinessRows(spec,{compact}))) error("LOGIC_PROJECTION","Business-path content differs from the canonical source projection.");
  }
  if (compact) {
    const points = nodes.filter((n) => Object.hasOwn(n.attrs, "data-sd-review-item"));
    const pending = nodes.filter((n) => Object.hasOwn(n.attrs, "data-sd-review-pending"));
    if (points.length < 1 || points.length > 6 || pending.length > 5 || figures.length > 2)
      error("COMPACT_LIMIT", "Compact review exceeds its point, pending or diagram limits.");
    if (ids.has("sd-source") || ids.has("sd-traceability") || nodes.some((n)=>n.name==="details"))
      error("COMPACT_APPENDIX", "Compact view must not contain a hidden full appendix or duplicated model.");
    if (spec && typeof spec === "object") {
      if (!Array.isArray(spec.review?.points) || !Array.isArray(spec.review?.diagramIds))
        error("COMPACT_SOURCE", "Compact view requires a review model.");
      else {
        if (reviewTextLength(spec) > REVIEW_LIMIT) error("COMPACT_LENGTH", "Compact source exceeds the review text budget.");
        if (points.length !== spec.review.points.length || spec.review.points.some((p,i)=>!points.some(n=>n.attrs["data-sd-review-item"]===String(i) && n.attrs["data-sd-review-refs"]===p.refs?.join(" "))))
          error("COMPACT_POINTS", "Review point IDs/references do not match the source.");
        if (pending.length !== (spec.scope?.assumptions?.length ?? 0) || pending.some((n,i)=>n.attrs["data-sd-review-pending"]!==String(i)))
          error("COMPACT_PENDING", "Pending items do not match the source.");
      }
    }
  }
  if (spec && typeof spec === "object") {
    const diagrams = compact ? reviewDiagrams(spec) : (Array.isArray(spec.diagrams) ? spec.diagrams : []);
    const expected = (compact ? [spec.id, ...diagrams.map(d=>d.id)] : [spec.id, ...COLLECTIONS.flatMap((key) => Array.isArray(spec[key]) ? spec[key].map((item) => item?.id) : [])]).filter(Boolean);
    for (const id of expected) if (!ids.has(id)) error("MISSING_SPEC_ITEM", `The page omits source item ${id}.`);
    if (figures.length !== diagrams.length) error("DIAGRAM_COUNT", `Expected ${diagrams.length} diagrams, found ${figures.length}.`);
    for (const diagram of diagrams) {
      const figure = figures.find((n) => n.attrs.id === diagram.id);
      if (!figure) continue; // Missing ID is already reported above.
      if (figure.attrs["data-sd-diagram"] !== diagram.type) error("DIAGRAM_TYPE", `${diagram.id} does not match source type ${diagram.type}.`);
      for (const [collection, attr] of [["nodes", "data-sd-node"], ["edges", "data-sd-edge"]]) {
        const markers = nodes.filter((n) => Object.hasOwn(n.attrs, attr) && inside(n, figure)).map((n) => n.attrs[attr]);
        const declared = Array.isArray(diagram[collection]) ? diagram[collection] : [];
        for (const item of declared) if (!markers.includes(item.id)) error("DIAGRAM_ITEM", `${diagram.id} omits ${collection === "nodes" ? "node" : "edge"} ${item.id}.`);
        if (new Set(markers).size !== markers.length) error("DIAGRAM_ITEM_DUPLICATE", `${diagram.id} has duplicate ${attr} markers.`);
        for (const marker of markers) if (!declared.some((item) => item.id === marker)) error("DIAGRAM_ITEM_EXTRA", `${diagram.id} includes undeclared ${attr}=${marker}.`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  const resolvers = [require];
  for (const dir of (process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean)) resolvers.push(createRequire(join(resolve(dir), "__sd_inspect__.cjs")));
  for (const resolver of resolvers) for (const name of ["playwright", "playwright-core"]) {
    try { return resolver(name); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  return null;
}

/** Read-only browser checks. Browser unavailability is skipped (or failed when required). */
export async function inspectBrowser(path, { required = false, executablePath, artifactDir } = {}) {
  const unavailable = (reason) => ({ status: required ? "failed" : "skipped", errors: required ? [reason] : [], reason });
  const absolute = resolve(path);
  try { await access(absolute, constants.R_OK); } catch (error) { return { status: "failed", errors: [`Cannot read HTML: ${error.message}`] }; }
  if (executablePath) {
    try { await access(executablePath, constants.X_OK); } catch (error) { return unavailable(`Browser executable unavailable: ${error.message}`); }
  }
  let playwright;
  try { playwright = resolvePlaywright(); } catch (error) { return unavailable(`Playwright could not be loaded: ${error.message}`); }
  if (!playwright?.chromium) return unavailable("Playwright is not installed. Install playwright or playwright-core to run browser checks.");
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }); }
  catch (error) { return unavailable(`Chromium could not start: ${error.message}`); }
  const errors = [], screenshots = [];
  const url = pathToFileURL(absolute).href;
  try {
    if (artifactDir) await mkdir(artifactDir, { recursive: true });
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
      const pageErrors = [], requested = new Set();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.context().setOffline(true);
      if (typeof page.routeWebSocket === "function") await page.routeWebSocket("**/*", (socket) => { requested.add(socket.url()); socket.close(); });
      await page.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (requestUrl === url || /^(?:data:|blob:|about:)/i.test(requestUrl)) await route.continue();
        else { requested.add(requestUrl); await route.abort(); }
      });
      try {
        await page.goto(url, { waitUntil: "load", timeout: 15000 });
        await page.waitForFunction(() => document.documentElement.dataset.sdReady === "ready", undefined, { timeout: 8000 });
        await page.evaluate(async () => {
          for (const details of document.querySelectorAll("details")) details.open = true;
          await document.fonts.ready;
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        const layoutErrors = await page.evaluate(() => {
          const found = [];
          if (document.documentElement.dataset.sdView === "compact") {
            const prose = [...document.querySelectorAll("[data-sd-review-text]")];
            const count = prose.reduce((n, el)=>n + [...el.textContent.replace(/\s/gu, "")].length, 0);
            if (count > 800) found.push("Compact review exceeds 800 visible prose characters.");
            if (prose.some((el)=>!el.getBoundingClientRect().height)) found.push("Compact review contains hidden prose.");
          }
          if (Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2) found.push("Document overflows the viewport horizontally; put wide figures/tables in a scroll container.");
          const transformedBox = (element, reference) => {
            const b = element.getBBox(), own = element.getCTM(), outer = reference.getCTM();
            if (!own || !outer) return null;
            const m = outer.inverse().multiply(own);
            const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
            return { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), right: Math.max(...points.map((p) => p.x)), bottom: Math.max(...points.map((p) => p.y)) };
          };
          for (const figure of document.querySelectorAll("figure[data-sd-diagram]")) {
            const svg = figure.querySelector("svg"), id = figure.id;
            if (!svg) { found.push(`${id}: SVG is missing.`); continue; }
            const v = svg.viewBox.baseVal;
            const labels = [...svg.querySelectorAll("text[data-sd-label]")];
            for (const label of labels) {
              const text = label.textContent.trim(), rect = label.getBoundingClientRect();
              if (!rect.width || !rect.height) { found.push(`${id}: label is hidden: ${text}.`); continue; }
              const b = transformedBox(label, svg), m = label.getScreenCTM();
              const size = parseFloat(getComputedStyle(label).fontSize) * Math.hypot(m?.a ?? 1, m?.b ?? 0);
              if (size < 11.9) found.push(`${id}: label is smaller than 12px on screen: ${text}.`);
              if (b && (b.x < v.x - 2 || b.y < v.y - 2 || b.right > v.x + v.width + 2 || b.bottom > v.y + v.height + 2)) found.push(`${id}: label is clipped by the SVG viewBox: ${text}.`);
            }
            for (const node of svg.querySelectorAll("g[data-sd-node]")) {
              const rect = node.querySelector("rect");
              if (!rect) continue;
              const outer = transformedBox(rect, svg);
              for (const text of node.querySelectorAll("text[data-sd-label]")) {
                const inner = transformedBox(text, svg);
                if (inner && outer && (inner.x < outer.x - 2 || inner.y < outer.y - 2 || inner.right > outer.right + 2 || inner.bottom > outer.bottom + 2)) found.push(`${id}: label exceeds node ${node.dataset.sdNode}: ${text.textContent.trim()}.`);
              }
            }
          }
          return found.slice(0, 100);
        });
        errors.push(...layoutErrors.map((s) => `${width}px: ${s}`));
        if (artifactDir) {
          const screenshot = join(resolve(artifactDir), `software-design-${width}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          screenshots.push(screenshot);
        }
      } catch (error) { errors.push(`${width}px: ${error.message}`); }
      errors.push(...pageErrors.map((s) => `${width}px JavaScript: ${s}`), ...[...requested].map((s) => `${width}px external runtime request: ${s}`));
      await page.close();
    }
  } catch (error) { errors.push(error.message); }
  finally { await browser.close(); }
  return { status: errors.length ? "failed" : "passed", errors: [...new Set(errors)], ...(screenshots.length ? { screenshots } : {}) };
}
