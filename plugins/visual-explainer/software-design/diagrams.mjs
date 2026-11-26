// Deterministic, dependency-free SVG. Labels come from the same model as the tables.
import { labelFor } from './model.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const ink = '#193344', muted = '#526879', accent = '#176b78', paper = '#ffffff', border = '#a8bdc8';
const face = "'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC', sans-serif";

// Width is conservative for CJK and wide Latin glyphs; every code point is kept.
export function wrapLabel(value, width, fontSize = 15) {
  const lines = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    let line = '', used = 0;
    for (const char of Array.from(paragraph)) {
      const units = /[\u2e80-\uffef]/u.test(char) || char.codePointAt(0) > 0xffff ? 1 : /[MW@#%]/.test(char) ? .9 : .65;
      const size = units * fontSize;
      if (line && used + size > width) { lines.push(line); line = ''; used = 0; }
      line += char; used += size;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function text(lines, x, y, { size = 15, weight = 400, color = ink, anchor = 'start', className = '' } = {}) {
  return `<text data-sd-label="" class="${esc(className)}" x="${x}" y="${y}" font-family="${face}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * 1.45 : 0}">${esc(line)}</tspan>`).join('')}</text>`;
}

function edgeLabel(edge, index) {
  if (edge.transitionId) {
    const transition = index.get(edge.transitionId);
    return `${transition?.event ?? edge.transitionId}${transition?.guard ? `；条件：${transition.guard}` : ''}`;
  }
  if (edge.apiId) {
    const api = index.get(edge.apiId);
    return api ? `${api.method} ${api.path} · ${api.title}` : edge.apiId;
  }
  return edge.label ?? edge.id;
}

function nodeContent(node, diagram, index) {
  const item = index.get(node.ref);
  const title = node.ref ? labelFor(item) || node.ref : node.label;
  const lines = wrapLabel(title, 244, 16);
  const details = diagram.type === 'er' ? (item?.fields ?? []).flatMap((field) => wrapLabel(`${field.name}: ${field.type}${field.required ? ' *' : ''}`, 244, 14)) : [];
  const identity = node.ref ?? node.id;
  const stateRole = item?.initial ? ' · 初始' : item?.terminal ? ' · 终态' : '';
  const ids = wrapLabel(identity + stateRole, 244, 14);
  const h = 25 + lines.length * 23 + (ids.length * 21) + (details.length ? 12 + details.length * 21 : 0) + 16;
  return { item, title, lines, details, ids, h };
}

function nodeSvg(node, content, x, y, w = 280) {
  const { h, lines, details, ids, item } = content;
  const kind = item?.initial ? '初始状态' : item?.terminal ? '终态' : '';
  const frame = item?.terminal ? `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="5" fill="none" stroke="${accent}"/>` : '';
  const titleY = y + 28;
  const idY = titleY + lines.length * 23 + 3;
  const detailY = idY + ids.length * 21 + 14;
  return `<g data-sd-node="${esc(node.id)}"${node.ref ? ` data-ref="${esc(node.ref)}"` : ''}><title>${esc(content.title)}${kind ? `（${kind}）` : ''}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${item?.initial ? '#e6f2f3' : paper}" stroke="${accent}" stroke-width="${item?.initial ? 2 : 1.4}"/>${frame}${text(lines, x + 18, titleY, { size: 16, weight: 600 })}${text(ids, x + 18, idY, { size: 14, color: muted })}${details.length ? `<path d="M${x + 16} ${detailY - 15}H${x + w - 16}" stroke="${border}"/>${text(details, x + 18, detailY, { size: 14 })}` : ''}</g>`;
}

function numberLabel(n, x, y) {
  return `<g aria-hidden="true"><circle cx="${x}" cy="${y}" r="12" fill="${paper}" stroke="${accent}"/>${text([String(n)], x, y + 5, { size: 14, weight: 600, color: accent, anchor: 'middle' })}</g>`;
}

function svgStart(diagram, width, height) {
  const marker = `sd-arrow-${diagram.id}`;
  return `<svg class="sd-svg" data-sd-svg="${esc(diagram.id)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="sd-title-${esc(diagram.id)}" style="min-width:${width}px"><title id="sd-title-${esc(diagram.id)}">${esc(diagram.title)}。${esc(diagram.purpose)}</title><defs><marker id="${esc(marker)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${accent}"/></marker></defs><rect width="${width}" height="${height}" fill="#f8fbfc"/>`;
}

// A vertical spine with separate return lanes keeps cycles and self-loops visible.
// Numbered arrows map to full labels on the right; no edge text is abbreviated.
function graph(diagram, index) {
  const nodes = diagram.nodes ?? [], edges = diagram.edges ?? [];
  const nodeOrder = new Map(nodes.map((node, i) => [node.id, i]));
  const pairCounts = new Map();
  for (const edge of edges) {
    const pair = JSON.stringify([edge.from, edge.to]);
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  // Parallel forward edges also need distinct lanes. Every incident rail gets
  // its own right-side port, including both ends of each self-loop.
  const laneEdges = edges.filter((edge) => nodeOrder.get(edge.to) !== nodeOrder.get(edge.from) + 1 || pairCounts.get(JSON.stringify([edge.from, edge.to])) > 1);
  const ports = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of laneEdges) {
    ports.get(edge.from)?.push({ edge, end: 'from' });
    ports.get(edge.to)?.push({ edge, end: 'to' });
  }
  const positions = new Map();
  let y = 32;
  for (const node of nodes) {
    const content = nodeContent(node, diagram, index);
    content.h = Math.max(content.h, (ports.get(node.id).length - 1) * 32 + 40);
    positions.set(node.id, { node, content, x: 30, y, w: 280, h: content.h });
    y += content.h + 70;
  }
  const portY = (position, edge, end) => {
    const slots = ports.get(position.node.id);
    const slot = slots.findIndex((port) => port.edge === edge && port.end === end);
    return position.y + position.h / 2 + (slot - (slots.length - 1) / 2) * 32;
  };
  const railStart = 352, legendX = railStart + laneEdges.length * 34 + 45;
  const legendWidth = 330;
  const descriptions = edges.map((edge, i) => {
    const heading = wrapLabel(`${i + 1}. ${edgeLabel(edge, index)}`, legendWidth, 15);
    const refs = edge.apiId ? [edge.apiId] : edge.transitionId ? [edge.transitionId] : (edge.refs ?? []);
    const detail = refs.flatMap((ref) => wrapLabel(ref, legendWidth, 14));
    return { edge, heading, detail, h: heading.length * 22 + detail.length * 21 + 28 };
  });
  let ly = 54;
  let legend = text(['箭头说明'], legendX, 28, { size: 15, weight: 600, color: muted });
  for (const desc of descriptions) {
    legend += text(desc.heading, legendX, ly, { size: 15 });
    if (desc.detail.length) legend += text(desc.detail, legendX, ly + desc.heading.length * 22 + 3, { size: 14, color: muted });
    ly += desc.h;
  }
  const width = Math.ceil(legendX + legendWidth + 30), height = Math.max(y - 38, ly + 8, 140);
  const arrow = `url(#sd-arrow-${diagram.id})`;
  let routes = '';
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i], source = positions.get(edge.from), target = positions.get(edge.to);
    if (!source || !target) throw new Error(`Unknown endpoint in ${diagram.id}/${edge.id}`);
    let d, nx, ny;
    if (!laneEdges.includes(edge)) {
      const x = source.x + source.w / 2, start = source.y + source.h, end = target.y;
      d = `M${x} ${start}V${end - 2}`; nx = x + 18; ny = (start + end) / 2;
    } else {
      const rail = railStart + laneEdges.indexOf(edge) * 34;
      const sy = portY(source, edge, 'from'), ty = portY(target, edge, 'to');
      d = `M${source.x + source.w} ${sy}H${rail}V${ty}H${target.x + target.w + 2}`;
      nx = rail; ny = (sy + ty) / 2;
    }
    routes += `<g data-sd-edge="${esc(edge.id)}"${edge.apiId || edge.transitionId ? ` data-ref="${esc(edge.apiId ?? edge.transitionId)}"` : ''}><title>${esc(edgeLabel(edge, index))}</title><path d="${d}" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linejoin="round" marker-end="${esc(arrow)}"/>${numberLabel(i + 1, nx, ny)}</g>`;
  }
  return svgStart(diagram, width, height) + routes + [...positions.values()].map((p) => nodeSvg(p.node, p.content, p.x, p.y)).join('') + legend + '</svg>';
}

function sequence(diagram, index) {
  const nodes = diagram.nodes ?? [], edges = diagram.edges ?? [];
  const participants = new Map();
  const spacing = 300, left = 36, width = Math.max(430, nodes.length * spacing + 72);
  let headHeight = 0;
  for (let i = 0; i < nodes.length; i++) {
    const content = nodeContent(nodes[i], diagram, index);
    participants.set(nodes[i].id, { node: nodes[i], content, x: left + i * spacing, cx: left + i * spacing + 140 });
    headHeight = Math.max(headHeight, content.h);
  }
  let y = headHeight + 90;
  const messages = edges.map((edge, i) => {
    const source = participants.get(edge.from), target = participants.get(edge.to);
    if (!source || !target) throw new Error(`Unknown endpoint in ${diagram.id}/${edge.id}`);
    const same = source === target;
    const labelWidth = same ? 230 : Math.max(210, Math.abs(target.cx - source.cx) - 20);
    const lines = wrapLabel(`${i + 1}. ${edgeLabel(edge, index)}`, labelWidth, 15);
    const row = { edge, source, target, same, lines, y };
    y += lines.length * 23 + (same ? 75 : 55);
    return row;
  });
  const height = y + 30;
  let body = '';
  for (const part of participants.values()) {
    body += `<path d="M${part.cx} ${32 + part.content.h}V${height - 25}" fill="none" stroke="${border}" stroke-width="1.4" stroke-dasharray="6 6"/>`;
    body += nodeSvg(part.node, part.content, part.x, 32);
  }
  for (const msg of messages) {
    const { edge, source, target, same, lines } = msg;
    const lineY = msg.y + lines.length * 23;
    const loopLeft = same && source.cx >= 261 && source === [...participants.values()].at(-1);
    const labelX = same ? (loopLeft ? source.cx - 245 : source.cx + 14) : Math.min(source.cx, target.cx) + 10;
    const d = same ? `M${source.cx} ${lineY}H${source.cx + (loopLeft ? -110 : 110)}V${lineY + 28}H${source.cx + (loopLeft ? -2 : 2)}` : `M${source.cx} ${lineY}H${target.cx + (target.cx > source.cx ? -2 : 2)}`;
    body += `<g data-sd-edge="${esc(edge.id)}"${edge.apiId ? ` data-ref="${esc(edge.apiId)}"` : ''}><title>${esc(edgeLabel(edge, index))}</title><rect x="${labelX - 3}" y="${msg.y - 17}" width="${same ? 237 : Math.abs(source.cx - target.cx) - 14}" height="${lines.length * 23 + 6}" fill="#f8fbfc"/>${text(lines, labelX, msg.y, { size: 15 })}<path d="${d}" fill="none" stroke="${accent}" stroke-width="1.8" marker-end="url(#sd-arrow-${esc(diagram.id)})"/></g>`;
  }
  return svgStart(diagram, width, height) + body + '</svg>';
}

export function renderDiagram(diagram, index) {
  if (!(index instanceof Map)) throw new TypeError('renderDiagram expects an index Map');
  return diagram.type === 'sequence' ? sequence(diagram, index) : graph(diagram, index);
}
