// lib/opm/transformMetroHtml.ts

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// Bubble size configuration (in pixels)
const NORMAL_BUBBLE_SIZE = 30; // diameter
const HUB_BUBBLE_SIZE = 60; // diameter

const BUBBLE_FILES: Record<string, string> = {
  blue: "/bubbles/bubble-blue.svg",
  green: "/bubbles/bubble-green.svg",
  grey: "/bubbles/bubble-grey.svg",
  purple: "/bubbles/bubble-purple.svg",
  red: "/bubbles/bubble-red.svg",
  teal: "/bubbles/bubble-teal.svg",
  yellow: "/bubbles/bubble-yellow.svg",
};

// Node bubble choice (supports both vivid + pastel palettes)
const STROKE_TO_BUBBLE: Record<string, string> = {
  // vivid/matplotlib-ish
  "#1f77b4": "blue",
  "#2ca02c": "green",
  "#d62728": "red",
  "#9467bd": "purple",
  "#8c564b": "grey",
  "#e377c2": "teal",
  "#ff7f0e": "yellow",

  // pastel
  "#a5d6ed": "blue",
  "#b1d59b": "green",
  "#abc1c1": "grey",
  "#bcb7e8": "purple",
  "#f2b1b2": "red",
  "#98e3e1": "teal",
  "#ffca87": "yellow",
};

// Edge/legend stroke remap → pastel palette
const STROKE_TO_PASTEL: Record<string, string> = {
  // vivid → pastel
  "#1f77b4": "#a5d6ed",
  "#2ca02c": "#b1d59b",
  "#d62728": "#f2b1b2",
  "#9467bd": "#bcb7e8",
  "#8c564b": "#abc1c1",
  "#e377c2": "#98e3e1",
  "#ff7f0e": "#ffca87",

  // already pastel
  "#a5d6ed": "#a5d6ed",
  "#b1d59b": "#b1d59b",
  "#abc1c1": "#abc1c1",
  "#bcb7e8": "#bcb7e8",
  "#f2b1b2": "#f2b1b2",
  "#98e3e1": "#98e3e1",
  "#ffca87": "#ffca87",
};

const FILL_TO_PASTEL: Record<string, string> = STROKE_TO_PASTEL;

export type TransformResult = {
  svg: string;
  warnings: string[];
};

function stripScriptsAndEventHandlers(root: Element) {
  root.querySelectorAll("script").forEach((n) => n.remove());
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  });
}

function normalizeHex(s: string): string {
  return (s || "").trim().toLowerCase();
}

function parseNumberAttr(el: Element, name: string, fallback: number): number {
  const v = parseFloat(el.getAttribute(name) || "");
  return Number.isFinite(v) ? v : fallback;
}

function ensureDefs(svgEl: SVGSVGElement): SVGDefsElement {
  let defs = svgEl.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svgEl.insertBefore(defs, svgEl.firstChild);
  }
  return defs as SVGDefsElement;
}

function ensureShadowFilter(defs: SVGDefsElement) {
  if (defs.querySelector("#flBubbleShadow")) return;

  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", "flBubbleShadow");
  filter.setAttribute("x", "-40%");
  filter.setAttribute("y", "-40%");
  filter.setAttribute("width", "180%");
  filter.setAttribute("height", "180%");
  filter.innerHTML =
    `<feDropShadow dx="0" dy="2" stdDeviation="3.0" flood-color="#000000" flood-opacity="0.10"/>`;
  defs.appendChild(filter);
}

function getSvgViewBoxFromFetchedSvg(svg: SVGSVGElement, warnings: string[], color: string): string {
  const vb = svg.getAttribute("viewBox");
  if (vb && vb.trim()) return vb.trim();

  const w = parseFloat(svg.getAttribute("width") || "");
  const h = parseFloat(svg.getAttribute("height") || "");
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return `0 0 ${w} ${h}`;
  }

  warnings.push(
    `Bubble "${color}" SVG has no viewBox (and no usable width/height). Using fallback viewBox "0 0 100 100".`
  );
  return "0 0 100 100";
}

// Remap strokes (attribute + inline style). Keeps it minimal & deterministic.
function remapStrokeOnElement(el: SVGElement) {
  const attr = normalizeHex(el.getAttribute("stroke") || "");
  if (attr && STROKE_TO_PASTEL[attr]) {
    el.setAttribute("stroke", STROKE_TO_PASTEL[attr]);
  }

  const style = el.getAttribute("style");
  if (style && /stroke\s*:/.test(style)) {
    el.setAttribute(
      "style",
      style.replace(/stroke\s*:\s*#[0-9a-fA-F]{6}/g, (m) => {
        const hex = m.split(":")[1].trim().toLowerCase();
        const mapped = STROKE_TO_PASTEL[hex];
        return mapped ? `stroke:${mapped}` : m;
      })
    );
  }
}

async function injectBubbleSymbol(defs: SVGDefsElement, color: string, warnings: string[]): Promise<void> {
  const symbolId = `bubble-${color}`;
  if (defs.querySelector(`#${CSS.escape(symbolId)}`)) return;

  const path = BUBBLE_FILES[color];
  if (!path) throw new Error(`No bubble file path configured for color "${color}".`);

  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to fetch bubble SVG for "${color}" from "${path}" (HTTP ${res.status}).`);
  }

  const svgText = await res.text();
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const fetchedSvg = parsed.querySelector("svg") as SVGSVGElement | null;
  if (!fetchedSvg) {
    throw new Error(`Fetched bubble SVG for "${color}" did not contain a <svg> root.`);
  }

  const symbol = document.createElementNS(SVG_NS, "symbol");
  symbol.setAttribute("id", symbolId);
  symbol.setAttribute("viewBox", getSvgViewBoxFromFetchedSvg(fetchedSvg, warnings, color));

  // Clone all children into symbol
  for (const node of Array.from(fetchedSvg.childNodes)) {
    symbol.appendChild(document.importNode(node, true));
  }

  defs.appendChild(symbol);
}

function resolveBubbleColorFromStroke(strokeRaw: string | null | undefined): string {
  const stroke = normalizeHex(strokeRaw || "");
  return STROKE_TO_BUBBLE[stroke] || "yellow";
}

function resolveBubbleKeyFromHexFill(fillHex: string): string {
  const hex = normalizeHex(fillHex || "");
  return STROKE_TO_BUBBLE[hex] || "grey";
}

function getHubColorsFromExistingWedges(nodeG: SVGGElement): string[] {
  const found: string[] = [];

  const candidates = Array.from(nodeG.querySelectorAll<SVGElement>("path, circle, rect, polygon"));
  for (const el of candidates) {
    // ignore geometry circle
    if (el.tagName.toLowerCase() === "circle" && el.classList.contains("node-border")) continue;

    const fillRaw = normalizeHex(el.getAttribute("fill") || "");
    if (!fillRaw || fillRaw === "none") continue;

    // keep only #RRGGBB
    if (!fillRaw.startsWith("#") || fillRaw.length !== 7) continue;

    const pastel = FILL_TO_PASTEL[fillRaw] ?? fillRaw;
    if (!found.includes(pastel)) found.push(pastel);
  }

  return found;
}

function removeOldHubWedges(nodeG: SVGGElement) {
  // Keep only:
  // - circle.node-border (geometry)
  // - <title> (tooltip)
  // - any <text> (labels)
  const keep = new Set<Element>();

  const border = nodeG.querySelector("circle.node-border");
  if (border) keep.add(border);

  const title = nodeG.querySelector("title");
  if (title) keep.add(title);

  nodeG.querySelectorAll("text").forEach((t) => keep.add(t));

  Array.from(nodeG.children).forEach((child) => {
    if (!keep.has(child)) child.remove();
  });
}

// ---------------- HUBS: use REAL bubble symbols, clipped ----------------
// NOTE: We use CLIP-PATH (not mask). Your DOM showed `mask="url(...)"` which can hide everything
// if the mask isn't defined or units mismatch. clipPathUnits=userSpaceOnUse fixes coords.

function ensureHubHalfClips(
  defs: SVGDefsElement,
  _cx: number,
  _cy: number,
  _r: number,
  clipTopId: string,
  clipBotId: string
) {
  const hasTop = defs.querySelector(`#${CSS.escape(clipTopId)}`);
  const hasBot = defs.querySelector(`#${CSS.escape(clipBotId)}`);
  if (hasTop && hasBot) return;

  // TOP HALF (0% → 50% height)
  const top = document.createElementNS(SVG_NS, "clipPath");
  top.setAttribute("id", clipTopId);
  top.setAttribute("clipPathUnits", "objectBoundingBox");

  const topRect = document.createElementNS(SVG_NS, "rect");
  topRect.setAttribute("x", "0");
  topRect.setAttribute("y", "0");
  topRect.setAttribute("width", "1");
  topRect.setAttribute("height", "0.5");
  top.appendChild(topRect);

  // BOTTOM HALF (50% → 100% height)
  const bot = document.createElementNS(SVG_NS, "clipPath");
  bot.setAttribute("id", clipBotId);
  bot.setAttribute("clipPathUnits", "objectBoundingBox");

  const botRect = document.createElementNS(SVG_NS, "rect");
  botRect.setAttribute("x", "0");
  botRect.setAttribute("y", "0.5");
  botRect.setAttribute("width", "1");
  botRect.setAttribute("height", "0.5");
  bot.appendChild(botRect);

  defs.appendChild(top);
  defs.appendChild(bot);
}

function ensureHubThirdClips(
  defs: SVGDefsElement,
  _cx: number,
  _cy: number,
  _r: number,
  a: string,
  b: string,
  c: string
) {
  const hasA = defs.querySelector(`#${CSS.escape(a)}`);
  const hasB = defs.querySelector(`#${CSS.escape(b)}`);
  const hasC = defs.querySelector(`#${CSS.escape(c)}`);
  if (hasA && hasB && hasC) return;

  const mk = (id: string, y: string) => {
    const cp = document.createElementNS(SVG_NS, "clipPath");
    cp.setAttribute("id", id);
    cp.setAttribute("clipPathUnits", "objectBoundingBox");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", y);
    rect.setAttribute("width", "1");
    rect.setAttribute("height", "0.3333333333");

    cp.appendChild(rect);
    defs.appendChild(cp);
  };

  mk(a, "0");
  mk(b, "0.3333333333");
  mk(c, "0.6666666666");
}

function makeBubbleUse(svgEl: SVGSVGElement, bubbleKey: string, cx: number, cy: number, r: number): SVGUseElement {
  const defs = ensureDefs(svgEl);
  const symbolId = `bubble-${bubbleKey}`;

  if (!defs.querySelector(`#${CSS.escape(symbolId)}`)) {
    throw new Error(`Hub needs symbol "${symbolId}" but it is missing in <defs>.`);
  }

  const useEl = document.createElementNS(SVG_NS, "use");
  const hrefVal = `#${symbolId}`;
  useEl.setAttribute("href", hrefVal);
  useEl.setAttributeNS(XLINK_NS, "xlink:href", hrefVal);

  useEl.setAttribute("x", String(cx - r));
  useEl.setAttribute("y", String(cy - r));
  useEl.setAttribute("width", String(r * 2));
  useEl.setAttribute("height", String(r * 2));
  useEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

  return useEl;
}

/**
 * Hub visual using SAME bubble SVGs (gradients/gloss) clipped into segments.
 * 2 colors => top/bottom halves
 * 3 colors => 3 horizontal curved bands (top/mid/bot)
 */
function buildHubBubbleVisual(
  svgEl: SVGSVGElement,
  cx: number,
  cy: number,
  r: number,
  colorsIn: string[],
  idSeed: string
): SVGGElement {
  const defs = ensureDefs(svgEl);

  // De-dupe & keep max 3
  const colors: string[] = [];
  for (const c of colorsIn) {
    const cc = normalizeHex(c);
    if (!cc) continue;
    if (!colors.includes(cc)) colors.push(cc);
    if (colors.length === 3) break;
  }

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("filter", "url(#flBubbleShadow)");
  g.classList.add("fl-hub-visual");

  // Always render something (never return empty = “invisible hub”)
  if (colors.length < 2) {
    const u = makeBubbleUse(svgEl, "grey", cx, cy, r);
    g.appendChild(u);
    return g;
  }

  if (colors.length === 2) {
    const clipTopId = `hub-clip-${idSeed}-top`;
    const clipBotId = `hub-clip-${idSeed}-bot`;
    ensureHubHalfClips(defs, cx, cy, r, clipTopId, clipBotId);

    const keyTop = resolveBubbleKeyFromHexFill(colors[0]);
    const keyBot = resolveBubbleKeyFromHexFill(colors[1]);

    const topUse = makeBubbleUse(svgEl, keyTop, cx, cy, r);
    topUse.setAttribute("clip-path", `url(#${clipTopId})`);
    g.appendChild(topUse);

    const botUse = makeBubbleUse(svgEl, keyBot, cx, cy, r);
    botUse.setAttribute("clip-path", `url(#${clipBotId})`);
    g.appendChild(botUse);

    return g;
  }

  // 3 colors -> 3 horizontal bands (curved by circle boundary)
  const c0 = `hub-clip-${idSeed}-b0`;
  const c1 = `hub-clip-${idSeed}-b1`;
  const c2 = `hub-clip-${idSeed}-b2`;
  ensureHubThirdClips(defs, cx, cy, r, c0, c1, c2);

  const key0 = resolveBubbleKeyFromHexFill(colors[0]);
  const key1 = resolveBubbleKeyFromHexFill(colors[1]);
  const key2 = resolveBubbleKeyFromHexFill(colors[2]);

  const u0 = makeBubbleUse(svgEl, key0, cx, cy, r);
  u0.setAttribute("clip-path", `url(#${c0})`);
  g.appendChild(u0);

  const u1 = makeBubbleUse(svgEl, key1, cx, cy, r);
  u1.setAttribute("clip-path", `url(#${c1})`);
  g.appendChild(u1);

  const u2 = makeBubbleUse(svgEl, key2, cx, cy, r);
  u2.setAttribute("clip-path", `url(#${c2})`);
  g.appendChild(u2);

  return g;
}

// ---------------- BIG ACTOR LABELS ----------------

function getLegendColorToName(svgEl: SVGSVGElement): Map<string, string> {
  const map = new Map<string, string>();

  const items = Array.from(svgEl.querySelectorAll<SVGGElement>("#legend .legend-item"));
  for (const item of items) {
    const line = item.querySelector<SVGLineElement>("line");
    const text = item.querySelector<SVGTextElement>("text");
    if (!line || !text) continue;

    const rawStroke = normalizeHex(line.getAttribute("stroke") || "");
    const stroke = STROKE_TO_PASTEL[rawStroke] ?? rawStroke;

    const name = (text.textContent || "").trim();
    if (stroke && name) map.set(stroke, name);
  }

  return map;
}

function getNodeCentersByStroke(svgEl: SVGSVGElement): Map<string, { x: number; y: number }[]> {
  const out = new Map<string, { x: number; y: number }[]>();

  const nodes = Array.from(svgEl.querySelectorAll<SVGGElement>("g.node.single"));
  for (const g of nodes) {
    const stroke = normalizeHex(g.getAttribute("data-stroke") || "");
    if (!stroke) continue;

    const use = g.querySelector<SVGUseElement>("use");
    if (!use) continue;

    const x = parseFloat(use.getAttribute("x") || "0");
    const y = parseFloat(use.getAttribute("y") || "0");
    const w = parseFloat(use.getAttribute("width") || "0");
    const h = parseFloat(use.getAttribute("height") || "0");

    const cx = x + w / 2;
    const cy = y + h / 2;

    if (!out.has(stroke)) out.set(stroke, []);
    out.get(stroke)!.push({ x: cx, y: cy });
  }

  return out;
}

function addActorEndLabels(svgEl: SVGSVGElement, warnings: string[]) {
  const legend = getLegendColorToName(svgEl);
  if (legend.size === 0) {
    warnings.push('No legend found (#legend .legend-item). Cannot generate big end labels.');
    return;
  }

  const vb = svgEl.viewBox?.baseVal;
  const center =
    vb && vb.width > 0 && vb.height > 0
      ? { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }
      : { x: 0, y: 0 };

  const nodesByStroke = getNodeCentersByStroke(svgEl);
  if (nodesByStroke.size === 0) {
    warnings.push('No node stroke metadata found. Did you add nodeG.setAttribute("data-stroke", ...) ?');
    return;
  }

  svgEl.querySelectorAll(".actor-label").forEach((n) => n.remove());

  for (const [stroke, name] of legend.entries()) {
    const pts = nodesByStroke.get(stroke);
    if (!pts || pts.length === 0) continue;

    let best = pts[0];
    let bestD = -1;
    for (const p of pts) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }

    const vx = best.x - center.x;
    const vy = best.y - center.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;

    const offset = 34;
    const lx = best.x + (vx / len) * offset;
    const ly = best.y + (vy / len) * offset;

    const text = document.createElementNS(SVG_NS, "text");
    text.classList.add("actor-label");
    text.setAttribute("x", String(lx));
    text.setAttribute("y", String(ly));
    text.setAttribute("text-anchor", vx >= 0 ? "start" : "end");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", stroke);
    text.textContent = name;

    svgEl.appendChild(text);
  }
}

// ---------------- MAIN TRANSFORM ----------------

export async function transformMetroHtmlToStyledSvg(htmlText: string): Promise<TransformResult> {
  const warnings: string[] = [];

  const doc = new DOMParser().parseFromString(htmlText, "text/html");

  let svg = doc.querySelector("svg#metro-svg") as SVGSVGElement | null;
  if (!svg) svg = doc.querySelector("svg") as SVGSVGElement | null;

  if (!svg) {
    return { svg: "", warnings: ["No <svg> found in the uploaded input."] };
  }

  stripScriptsAndEventHandlers(doc.documentElement);

  const svgClone = svg.cloneNode(true) as SVGSVGElement;
  stripScriptsAndEventHandlers(svgClone);

  await injectStyleIntoSvg(svgClone, warnings);

  const svgString = new XMLSerializer().serializeToString(svgClone);

  if (!svgClone.getAttribute("viewBox")) {
    warnings.push("SVG has no viewBox. Scaling/pan/zoom will be harder later.");
  }

  if (!svgString.includes("<symbol") || !svgString.includes("<use")) {
    warnings.push("Bubble replacement may not have been applied (no <symbol> or <use> found in output).");
  }

  return { svg: svgString, warnings };
}

// ---- EDGE CURVING (polyline / straight-line paths -> smooth cubic Beziers) ----

type Pt = { x: number; y: number };

// Parse "x1,y1 x2,y2 ..." points from <polyline points="...">
function parsePolylinePoints(pointsAttr: string | null): Pt[] {
  if (!pointsAttr) return [];
  const nums = pointsAttr
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((n) => parseFloat(n))
    .filter((n) => Number.isFinite(n));

  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function copyPresentationAttributes(fromEl: SVGElement, toEl: SVGElement) {
  const geometryAttrs = new Set(["x1", "y1", "x2", "y2", "points", "d"]);

  for (const attr of Array.from(fromEl.attributes)) {
    if (geometryAttrs.has(attr.name)) continue;
    toEl.setAttribute(attr.name, attr.value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function upsertStyleDeclaration(style: string | null, prop: string, value: string): string {
  const trimmed = (style || "").trim();
  const re = new RegExp(`(^|;)\\s*${prop}\\s*:[^;]*`, "i");

  if (!trimmed) return `${prop}:${value}`;
  if (re.test(trimmed)) {
    return trimmed.replace(re, (_match, prefix: string) => `${prefix}${prop}:${value}`);
  }

  const suffix = trimmed.endsWith(";") ? "" : ";";
  return `${trimmed}${suffix}${prop}:${value}`;
}

function ensureRoundLineStyling(el: SVGElement) {
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");

  let style = el.getAttribute("style");
  style = upsertStyleDeclaration(style, "stroke-linecap", "round");
  style = upsertStyleDeclaration(style, "stroke-linejoin", "round");
  el.setAttribute("style", style);
}

type EdgeSegment = {
  start: Pt;
  end: Pt;
};

type GraphNode = {
  id: number;
  pt: Pt;
  count: number;
  edges: number[];
};

type GraphSegment = EdgeSegment & {
  id: number;
  startNodeId: number;
  endNodeId: number;
};

type EdgeChain = {
  points: Pt[];
  closed: boolean;
};

function getActorClass(el: SVGElement): string | null {
  const candidates = [el, el.closest(".edge") as SVGElement | null];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const actorClass = Array.from(candidate.classList).find((name) => /^actor-\d+$/i.test(name));
    if (actorClass) return actorClass;
  }
  return null;
}

function getStrokeKey(el: SVGElement): string {
  const strokeAttr = normalizeHex(el.getAttribute("stroke") || el.closest(".edge")?.getAttribute("stroke") || "");
  if (strokeAttr) return strokeAttr;

  const style = el.getAttribute("style") || el.closest(".edge")?.getAttribute("style") || "";
  const match = style.match(/stroke\s*:\s*([^;]+)/i);
  return normalizeHex(match?.[1] || "") || "unknown";
}

function getEdgeGroupKey(el: SVGElement): string {
  const actorClass = getActorClass(el);
  return actorClass ? `actor:${actorClass}` : `stroke:${getStrokeKey(el)}`;
}

function parsePathEndpoints(d: string | null): EdgeSegment[] {
  if (!d) return [];
  const trimmed = d.trim();
  if (!trimmed || !/^[Mm]/.test(trimmed)) return [];

  const nums = trimmed.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 4) return [];

  const x1 = parseFloat(nums[0]);
  const y1 = parseFloat(nums[1]);
  const x2 = parseFloat(nums[nums.length - 2]);
  const y2 = parseFloat(nums[nums.length - 1]);

  if (![x1, y1, x2, y2].every(Number.isFinite)) return [];
  return [{ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }];
}

function extractSegmentsFromEdgeElement(el: SVGElement): EdgeSegment[] {
  const tag = el.tagName.toLowerCase();

  if (tag === "line") {
    const x1 = parseNumberAttr(el, "x1", NaN);
    const y1 = parseNumberAttr(el, "y1", NaN);
    const x2 = parseNumberAttr(el, "x2", NaN);
    const y2 = parseNumberAttr(el, "y2", NaN);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return [];
    return [{ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }];
  }

  if (tag === "path") {
    return parsePathEndpoints(el.getAttribute("d"));
  }

  if (tag === "polyline") {
    const pts = parsePolylinePoints(el.getAttribute("points"));
    const segments: EdgeSegment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ start: pts[i], end: pts[i + 1] });
    }
    return segments;
  }

  return [];
}

function distanceBetween(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointsEqual(a: Pt, b: Pt, epsilon = 0.01): boolean {
  return distanceBetween(a, b) <= epsilon;
}

function getOrCreateSnappedNode(nodes: GraphNode[], pt: Pt, epsilon: number): number {
  let bestNode: GraphNode | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    const dist = distanceBetween(node.pt, pt);
    if (dist <= epsilon && dist < bestDistance) {
      bestNode = node;
      bestDistance = dist;
    }
  }

  if (bestNode) {
    const nextCount = bestNode.count + 1;
    bestNode.pt = {
      x: (bestNode.pt.x * bestNode.count + pt.x) / nextCount,
      y: (bestNode.pt.y * bestNode.count + pt.y) / nextCount,
    };
    bestNode.count = nextCount;
    return bestNode.id;
  }

  const node: GraphNode = {
    id: nodes.length,
    pt: { ...pt },
    count: 1,
    edges: [],
  };
  nodes.push(node);
  return node.id;
}

function buildSegmentGraph(segments: EdgeSegment[], epsilon: number): {
  nodes: GraphNode[];
  graphSegments: GraphSegment[];
} {
  const nodes: GraphNode[] = [];
  const graphSegments: GraphSegment[] = [];

  for (const segment of segments) {
    const startNodeId = getOrCreateSnappedNode(nodes, segment.start, epsilon);
    const endNodeId = getOrCreateSnappedNode(nodes, segment.end, epsilon);
    const graphSegment: GraphSegment = {
      ...segment,
      id: graphSegments.length,
      startNodeId,
      endNodeId,
    };
    graphSegments.push(graphSegment);
    nodes[startNodeId].edges.push(graphSegment.id);
    nodes[endNodeId].edges.push(graphSegment.id);
  }

  return { nodes, graphSegments };
}

function dedupeChainPoints(points: Pt[], epsilon = 0.01): Pt[] {
  const deduped: Pt[] = [];
  for (const pt of points) {
    if (deduped.length === 0 || !pointsEqual(deduped[deduped.length - 1], pt, epsilon)) {
      deduped.push(pt);
    }
  }
  return deduped;
}

function traceEdgeChains(segments: EdgeSegment[], epsilon = 1): EdgeChain[] {
  const { nodes, graphSegments } = buildSegmentGraph(segments, epsilon);
  const usedSegments = new Set<number>();
  const chains: EdgeChain[] = [];

  const walkChain = (startNodeId: number, startSegmentId: number): EdgeChain => {
    const points: Pt[] = [{ ...nodes[startNodeId].pt }];
    let currentNodeId = startNodeId;
    let currentSegmentId: number | null = startSegmentId;
    let closed = false;

    while (currentSegmentId != null) {
      usedSegments.add(currentSegmentId);
      const segment: GraphSegment = graphSegments[currentSegmentId];
      const nextNodeId: number =
        segment.startNodeId === currentNodeId ? segment.endNodeId : segment.startNodeId;

      points.push({ ...nodes[nextNodeId].pt });

      const nextOptions: number[] = nodes[nextNodeId].edges.filter(
        (edgeId) => !usedSegments.has(edgeId)
      );
      if (nextOptions.length !== 1) {
        closed = nextNodeId === startNodeId && nextOptions.length === 0;
        break;
      }

      currentNodeId = nextNodeId;
      currentSegmentId = nextOptions[0];
    }

    return { points: dedupeChainPoints(points), closed };
  };

  for (const node of nodes) {
    if (node.edges.length === 2) continue;
    for (const segmentId of node.edges) {
      if (usedSegments.has(segmentId)) continue;
      chains.push(walkChain(node.id, segmentId));
    }
  }

  for (const segment of graphSegments) {
    if (usedSegments.has(segment.id)) continue;
    chains.push(walkChain(segment.startNodeId, segment.id));
  }

  return chains.filter((chain) => chain.points.length >= 2);
}

function pointLineDistance(pt: Pt, start: Pt, end: Pt): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-6) return distanceBetween(pt, start);

  const t = ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / lengthSq;
  const proj = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  return distanceBetween(pt, proj);
}

function getInteriorAngle(prev: Pt, curr: Pt, next: Pt): number {
  const ax = prev.x - curr.x;
  const ay = prev.y - curr.y;
  const bx = next.x - curr.x;
  const by = next.y - curr.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);

  if (lenA < 1e-6 || lenB < 1e-6) return 180;

  const dot = ax * bx + ay * by;
  const cos = clamp(dot / (lenA * lenB), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function isNearlyStraightChain(points: Pt[]): boolean {
  if (points.length <= 2) return true;

  const start = points[0];
  const end = points[points.length - 1];
  const overallLength = distanceBetween(start, end);
  if (overallLength < 1) return true;

  let maxDeviation = 0;

  for (let i = 1; i < points.length - 1; i++) {
    maxDeviation = Math.max(maxDeviation, pointLineDistance(points[i], start, end));
  }

  return maxDeviation < 6;
}

function buildLinearChainPath(points: Pt[]): string {
  const d = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    d.push(`L ${points[i].x} ${points[i].y}`);
  }
  return d.join(" ");
}

function simplifyPoints(points: Pt[]): Pt[] {
  if (points.length <= 2) return points;

  const simplified: Pt[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    if (distanceBetween(curr, prev) < 4) continue;
    if (getInteriorAngle(prev, curr, next) > 175) continue;

    simplified.push(curr);
  }

  const last = points[points.length - 1];
  if (!pointsEqual(simplified[simplified.length - 1], last)) {
    simplified.push(last);
  }

  return simplified;
}

function catmullRomToBezierPath(points: Pt[], tension = 0.85): string {
  if (points.length <= 2) return buildLinearChainPath(points);

  const t = clamp(tension, 0.05, 1.5);
  const d: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1.x + ((p2.x - p0.x) / 6) * (1 / t);
    const c1y = p1.y + ((p2.y - p0.y) / 6) * (1 / t);
    const c2x = p2.x - ((p3.x - p1.x) / 6) * (1 / t);
    const c2y = p2.y - ((p3.y - p1.y) / 6) * (1 / t);

    d.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`);
  }

  return d.join(" ");
}

function buildMergedEdgePath(
  templateEl: SVGElement,
  points: Pt[],
  actorClass: string | null,
  tension: number
): SVGPathElement | null {
  const normalizedPoints = dedupeChainPoints(points);
  const simplifiedPoints = simplifyPoints(normalizedPoints);
  if (simplifiedPoints.length < 2) return null;

  const d = isNearlyStraightChain(simplifiedPoints)
    ? buildLinearChainPath(simplifiedPoints)
    : catmullRomToBezierPath(simplifiedPoints, tension);
  if (!d) return null;

  const pathEl = document.createElementNS(SVG_NS, "path");
  pathEl.setAttribute("d", d);
  pathEl.setAttribute("fill", "none");
  copyPresentationAttributes(templateEl, pathEl);
  pathEl.classList.add("edge");
  if (actorClass) pathEl.classList.add(actorClass);
  ensureRoundLineStyling(pathEl);

  return pathEl;
}

// Merge edge segments per actor and emit single smooth paths per traced chain.
function curveEdges(svgEl: SVGSVGElement, tension = 0.65) {
  const edgeElements = Array.from(
    new Set(
      Array.from(
        svgEl.querySelectorAll<SVGElement>("line.edge, path.edge, polyline.edge, .edge line, .edge path, .edge polyline")
      )
    )
  ).filter((el) => !el.closest("#legend"));

  const groups = new Map<
    string,
    {
      actorClass: string | null;
      templateEl: SVGElement;
      elements: SVGElement[];
      segments: EdgeSegment[];
    }
  >();

  for (const el of edgeElements) {
    const segments = extractSegmentsFromEdgeElement(el);
    if (segments.length === 0) continue;

    const key = getEdgeGroupKey(el);
    const existing = groups.get(key);
    if (existing) {
      existing.elements.push(el);
      existing.segments.push(...segments);
      continue;
    }

    groups.set(key, {
      actorClass: getActorClass(el),
      templateEl: el,
      elements: [el],
      segments,
    });
  }

  for (const group of groups.values()) {
    const parent = group.templateEl.parentNode;
    if (!parent) continue;

    const chains = traceEdgeChains(group.segments, 1);
    const mergedPaths = chains
      .map((chain) => buildMergedEdgePath(group.templateEl, chain.points, group.actorClass, tension))
      .filter((pathEl): pathEl is SVGPathElement => Boolean(pathEl));

    for (const mergedPath of mergedPaths) {
      parent.insertBefore(mergedPath, group.templateEl);
    }

    for (const el of group.elements) {
      el.remove();
    }
  }
}

async function injectStyleIntoSvg(svgEl: SVGSVGElement, warnings: string[]): Promise<void> {
  // Remove embedded styles (we control styling)
  svgEl.querySelectorAll("style").forEach((n) => n.remove());

  // Remove big white background rect if present
  const bgRect = svgEl.querySelector('rect[x="0"][y="0"][width][height][fill="white"]');
  if (bgRect) bgRect.remove();

  // Responsive SVG
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.classList.add("fl-opm");

  const defs = ensureDefs(svgEl);
  ensureShadowFilter(defs);

  // Remap edge + legend strokes to pastel palette
  svgEl.querySelectorAll<SVGElement>(".edge").forEach(remapStrokeOnElement);
  svgEl.querySelectorAll<SVGElement>("#legend line").forEach(remapStrokeOnElement);

  // Make metro lines curved (Bezier)
  curveEdges(svgEl, 0.85);

  // ---- Single bubbles: replace circles with <use> referencing injected <symbol> ----
  const singleNodes = Array.from(svgEl.querySelectorAll<SVGGElement>("g.node.single"));
  if (singleNodes.length === 0) warnings.push('No "g.node.single" nodes found. Nothing to replace.');

  // 1) Collect needed bubble colors for singles
  const neededColors = new Set<string>();
  for (const nodeG of singleNodes) {
    const outer = nodeG.querySelector<SVGCircleElement>("circle.node-outer");
    if (!outer) continue;
    neededColors.add(resolveBubbleColorFromStroke(outer.getAttribute("stroke")));
  }

  // 2) Fetch + inject symbols into <defs>
  for (const color of neededColors) {
    await injectBubbleSymbol(defs, color, warnings);
  }

  // 3) Replace circles with <use>
  let replaced = 0;
  let missingOuter = 0;

  for (const nodeG of singleNodes) {
    const outer = nodeG.querySelector<SVGCircleElement>("circle.node-outer");
    if (!outer) {
      missingOuter++;
      continue;
    }

    const cx = parseNumberAttr(outer, "cx", 0);
    const cy = parseNumberAttr(outer, "cy", 0);
    const r = parseNumberAttr(outer, "r", 10);

    const color = resolveBubbleColorFromStroke(outer.getAttribute("stroke"));
    const symbolId = `bubble-${color}`;

    if (!defs.querySelector(`#${CSS.escape(symbolId)}`)) {
      throw new Error(`Bubble symbol "${symbolId}" is missing in <defs>.`);
    }

    const normalMultiplier = NORMAL_BUBBLE_SIZE / (r * 2);
    const size = r * 2 * normalMultiplier;

    const useEl = document.createElementNS(SVG_NS, "use");
    useEl.setAttribute("x", String(cx - size / 2));
    useEl.setAttribute("y", String(cy - size / 2));
    useEl.setAttribute("width", String(size));
    useEl.setAttribute("height", String(size));

    const hrefVal = `#${symbolId}`;
    useEl.setAttribute("href", hrefVal);
    useEl.setAttributeNS(XLINK_NS, "xlink:href", hrefVal);

    useEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    useEl.setAttribute("filter", "url(#flBubbleShadow)");

    nodeG.insertBefore(useEl, nodeG.firstChild);

    // store pastel stroke for big labels
    const rawStroke = normalizeHex(outer.getAttribute("stroke") || "");
    const pastelStroke = STROKE_TO_PASTEL[rawStroke] ?? rawStroke;
    nodeG.setAttribute("data-stroke", pastelStroke);

    // Remove old circles
    outer.remove();
    const inner = nodeG.querySelector<SVGCircleElement>("circle.node-inner");
    if (inner) inner.remove();

    replaced++;
  }

  if (missingOuter > 0) warnings.push(`${missingOuter} "g.node.single" nodes had no circle.node-outer.`);
  if (replaced === 0 && singleNodes.length > 0) warnings.push("No bubbles were replaced (0 replacements).");

  // ---- Hub bubbles: REBUILD using clipped bubble symbols ----
  const hubTargetR = HUB_BUBBLE_SIZE / 2;
  const hubs = Array.from(svgEl.querySelectorAll<SVGGElement>("g.node.intersection"));

  for (let hubIdx = 0; hubIdx < hubs.length; hubIdx++) {
    const nodeG = hubs[hubIdx];
    nodeG.classList.add("fl-hub");

    const border = nodeG.querySelector<SVGCircleElement>("circle.node-border");
    if (!border) continue;

    const cx = parseNumberAttr(border, "cx", 0);
    const cy = parseNumberAttr(border, "cy", 0);
    const r0 = parseNumberAttr(border, "r", 0);
    if (r0 <= 0) continue;

    // 1) detect hub colors
    let colors = getHubColorsFromExistingWedges(nodeG);

    // If detection fails, still render a hub (so it never disappears)
    if (colors.length < 2) colors = ["#abc1c1", "#abc1c1"];

    // 2) ensure required bubble symbols exist for hub colors
    for (const hex of colors.slice(0, 3)) {
      const key = resolveBubbleKeyFromHexFill(hex);
      await injectBubbleSymbol(defs, key, warnings);
    }

    // 3) remove old hub visuals (wedges)
    removeOldHubWedges(nodeG);

    // 4) remove any previous generated hub visuals (when reprocessing multiple times)
    nodeG.querySelectorAll(".fl-hub-visual").forEach((n) => n.remove());

    // 5) resize border (geometry only)
    border.setAttribute("r", String(hubTargetR));
    border.setAttribute("stroke", "none");
    border.setAttribute("stroke-width", "0");
    border.setAttribute("fill", "none");

    // 6) build and insert the new hub visual
    const hubVisual = buildHubBubbleVisual(svgEl, cx, cy, hubTargetR, colors.slice(0, 3), `hub${hubIdx}`);
    nodeG.insertBefore(hubVisual, nodeG.firstChild);
  }

  // Big actor labels
  addActorEndLabels(svgEl, warnings);

  // ---- Inject CSS last ----
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = `
    .fl-opm { width: 100%; max-width: 100%; height: auto; display: block; overflow: visible; }

    /* Lines */
    .fl-opm .edge{
      stroke-linecap: round;
      stroke-width: 8;
      opacity: 1;
    }

    /* Text */
    .fl-opm .label-text,
    .fl-opm .legend-text{
      font-family: "Open Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
      letter-spacing: 0.2px;
    }
    .fl-opm .label-text{ font-size: 11px; fill: #4c5b60; }
    .fl-opm .legend-text{ font-size: 13px; fill: #0b0f14; font-weight: 600; }

    /* Hide legend but keep it in DOM for data extraction */
    .fl-opm #legend{ display: none; }

    /* Big end labels (actor/topic names) */
    .fl-opm .actor-label{
      font-family: "Open Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.2px;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 6px;
    }
  `;

  const firstChild = svgEl.firstChild;
  if (firstChild) svgEl.insertBefore(style, firstChild);
  else svgEl.appendChild(style);
}
