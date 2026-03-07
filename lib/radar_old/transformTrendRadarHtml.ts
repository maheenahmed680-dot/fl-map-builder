import {
  bubbleAssetUrls,
  bubbleSymbolIds,
  bubbleTypes,
  bubbleBucketTypeMap,   // <-- add this
  type BubbleType,
} from "@/lib/radar/radarConfig";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

type ViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RadarFrame = {
  cx: number;
  cy: number;
  radius: number;
};

type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type BubbleCandidate = {
  source: SVGElement;
  remove: SVGElement[];
  cx: number;
  cy: number;
  radius: number;
  type: BubbleType;
  color: string;
  label: string;
  angle: number;
  labelX: number;
  labelY: number;
  rotation: number;
};

const CONNECTOR_COLORS: Record<BubbleType, string> = {
  "Sehr hoch": "#d97aab",
  Hoch: "#7bd6df",
  Niedrig: "#b8afd9",
  "Sehr niedrig": "#bfc7cf",
};

type LabelCandidate = {
  element: SVGTextElement;
  text: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
};

export type RadarTransformResult = {
  bubbles: Array<{
    id: string;
    label: string;
    type: BubbleType;
  }>;
  svg: string;
  warnings: string[];
};

type RadarTransformOptions = {
  bubbleAssets?: Record<string, string>;
  logoAsset?: string;
  overrides?: Record<string, { label?: string; type?: BubbleType }>;
  selectedBubbleId?: string | null;
};

function stripScriptsAndEventHandlers(root: Element) {
  root.querySelectorAll("script").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    }
  });
}

function normalizeValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeColor(value: string | null | undefined): string {
  return normalizeValue(value).replace(/\s+/g, "");
}

function parseNumber(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function detectAxisIntersection(svg: SVGSVGElement): { cx: number; cy: number } | null {
  const lines = Array.from(svg.querySelectorAll<SVGLineElement>("line"))
    .filter((el) => !el.closest("defs"))
    .map((el) => {
      const stroke = getInheritedAttribute(el, "stroke") || resolveComputedStroke(el);
      if (!isNeutralStrokeColor(stroke, el)) return null;

      const x1 = parseNumber(el.getAttribute("x1"), NaN);
      const y1 = parseNumber(el.getAttribute("y1"), NaN);
      const x2 = parseNumber(el.getAttribute("x2"), NaN);
      const y2 = parseNumber(el.getAttribute("y2"), NaN);
      if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

      const matrix = getElementMatrix(el);
      const start = applyMatrix({ x: x1, y: y1 }, matrix);
      const end = applyMatrix({ x: x2, y: y2 }, matrix);
      const len = Math.hypot(end.x - start.x, end.y - start.y);

      return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, len };
    })
    .filter((v): v is { x1: number; y1: number; x2: number; y2: number; len: number } => Boolean(v))
    .sort((a, b) => b.len - a.len);

  if (lines.length < 2) return null;

  const a = lines[0];
  // pick another long line that isn't nearly parallel
  let b = lines.find((l, i) => i > 0 && Math.abs(((a.x2 - a.x1) * (l.y2 - l.y1)) - ((a.y2 - a.y1) * (l.x2 - l.x1))) > 1e-2);
  if (!b) b = lines[1];

  // line intersection (infinite lines)
  const x1 = a.x1, y1 = a.y1, x2 = a.x2, y2 = a.y2;
  const x3 = b.x1, y3 = b.y1, x4 = b.x2, y4 = b.y2;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;

  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { cx: px, cy: py };
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function angleDelta(a: number, b: number): number {
  const delta = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(delta);
}

function identityMatrix(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function applyMatrix(point: { x: number; y: number }, matrix: Matrix2D) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function transformRadius(radius: number, matrix: Matrix2D): number {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const scale = (scaleX + scaleY) / 2 || 1;
  return radius * scale;
}

function parseTransformList(transformValue: string | null | undefined): Matrix2D {
  const value = (transformValue ?? "").trim();
  if (!value) return identityMatrix();

  const pattern = /([a-zA-Z]+)\(([^)]*)\)/g;
  let current = identityMatrix();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    const command = match[1].toLowerCase();
    const args = match[2]
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));

    let next = identityMatrix();

    if (command === "matrix" && args.length >= 6) {
      next = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    } else if (command === "translate") {
      next.e = args[0] ?? 0;
      next.f = args[1] ?? 0;
    } else if (command === "scale") {
      next.a = args[0] ?? 1;
      next.d = args[1] ?? args[0] ?? 1;
    } else if (command === "rotate") {
      const angle = degToRad(args[0] ?? 0);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      next = multiplyMatrices(
        multiplyMatrices(
          { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy },
          { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
        ),
        { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
      );
    }

    current = multiplyMatrices(current, next);
  }

  return current;
}

function getElementMatrix(element: Element): Matrix2D {
  let current = identityMatrix();
  let node: Element | null = element;

  while (node && node instanceof Element) {
    current = multiplyMatrices(parseTransformList(node.getAttribute("transform")), current);
    node = node.parentElement;
    if (node?.tagName.toLowerCase() === "svg") {
      current = multiplyMatrices(parseTransformList(node.getAttribute("transform")), current);
      break;
    }
  }

  return current;
}

function ensureViewBox(svg: SVGSVGElement, warnings: string[]): ViewBox {
  const existing = svg.getAttribute("viewBox");
  if (existing) {
    const parts = existing
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));

    if (parts.length === 4) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }

  const width = parseNumber(svg.getAttribute("width"), 0);
  const height = parseNumber(svg.getAttribute("height"), 0);

  if (width > 0 && height > 0) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return { x: 0, y: 0, width, height };
  }

  warnings.push('SVG has no usable viewBox or width/height. Falling back to "0 0 1000 1000".');
  svg.setAttribute("viewBox", "0 0 1000 1000");
  return { x: 0, y: 0, width: 1000, height: 1000 };
}

function scoreSvg(svg: SVGSVGElement): number {
  const keywords = `${svg.id} ${svg.getAttribute("class") ?? ""}`.toLowerCase();
  let score = svg.querySelectorAll("circle").length * 3 + svg.querySelectorAll("text").length * 2;

  if (keywords.includes("radar")) score += 30;
  if (keywords.includes("trend")) score += 20;
  if (keywords.includes("bubble")) score += 10;
  if (svg.getAttribute("viewBox")) score += 5;

  return score;
}

function selectRadarSvg(doc: Document): SVGSVGElement | null {
  const svgs = Array.from(doc.querySelectorAll("svg")) as SVGSVGElement[];
  if (svgs.length === 0) return null;

  return svgs.reduce((best, candidate) => (scoreSvg(candidate) > scoreSvg(best) ? candidate : best));
}

type FrameCandidate = {
  cx: number;
  cy: number;
  preferred: boolean;
  radius: number;
};

function isBubbleShape(element: SVGElement): boolean {
  return (
    element.classList.contains("bubble") ||
    element.hasAttribute("data-trend") ||
    element.hasAttribute("data-bucket")
  );
}

function collectFrameCandidates(svg: SVGSVGElement, tag: "circle" | "ellipse"): FrameCandidate[] {
  return Array.from(svg.querySelectorAll<SVGElement>(tag))
    .filter((element) => !element.closest("defs") && !isBubbleShape(element))
    .map((element) => {
      const matrix = getElementMatrix(element);
      const fill = normalizeColor(getInheritedAttribute(element, "fill"));
      const stroke = normalizeColor(getInheritedAttribute(element, "stroke"));
      const opacity = parseNumber(getInheritedAttribute(element, "opacity"), 1);

      const cx = parseNumber(element.getAttribute("cx"), NaN);
      const cy = parseNumber(element.getAttribute("cy"), NaN);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || opacity <= 0) return null;

      const center = applyMatrix({ x: cx, y: cy }, matrix);
      const radius =
        tag === "circle"
          ? transformRadius(parseNumber(element.getAttribute("r"), 0), matrix)
          : transformRadius(
              (parseNumber(element.getAttribute("rx"), 0) + parseNumber(element.getAttribute("ry"), 0)) / 2,
              matrix,
            );

      if (!(radius > 0)) return null;

      return {
        cx: center.x,
        cy: center.y,
        preferred: (fill === "" || fill === "none") && stroke !== "" && stroke !== "none",
        radius,
      } satisfies FrameCandidate;
    })
    .filter((candidate): candidate is FrameCandidate => Boolean(candidate));
}

function computeRadarFrameFromExplicitBubbles(svg: SVGSVGElement): RadarFrame | null {
  const bubbleEls = Array.from(
    svg.querySelectorAll<SVGElement>("circle.bubble, [data-trend], [data-bucket]"),
  ).filter((el) => !el.closest("defs"));

  const bubbles = bubbleEls
    .map((el) => getBubbleGeometry(el))
    .filter((g): g is { cx: number; cy: number; radius: number } => Boolean(g && g.radius > 0));

  if (bubbles.length === 0) return null;

  const cx = bubbles.reduce((sum, b) => sum + b.cx, 0) / bubbles.length;
  const cy = bubbles.reduce((sum, b) => sum + b.cy, 0) / bubbles.length;

  let maxDist = 0;
  let maxR = 0;
  for (const b of bubbles) {
    maxDist = Math.max(maxDist, distance(cx, cy, b.cx, b.cy));
    maxR = Math.max(maxR, b.radius);
  }

  const padding = 40;
  return { cx, cy, radius: maxDist + maxR + padding };
}

function computeRadarRadiusFromExplicitBubbles(
  bubbles: Array<{ cx: number; cy: number; radius: number }>,
  center: { cx: number; cy: number },
): number | null {
  if (bubbles.length === 0) return null;

  let maxDist = 0;
  let maxR = 0;
  for (const bubble of bubbles) {
    maxDist = Math.max(maxDist, distance(center.cx, center.cy, bubble.cx, bubble.cy));
    maxR = Math.max(maxR, bubble.radius);
  }

  return maxDist + maxR + 40;
}

function collectExplicitBubbleCandidates(
  svg: SVGSVGElement,
  frame: RadarFrame,
  warnings: string[],
  explicitBubbles: Array<{ cx: number; cy: number; radius: number }>,
): BubbleCandidate[] {
  const dedupe = new Map<string, BubbleCandidate>();

  // Only use elements that are explicitly marked as bubbles
  const els = Array.from(
    svg.querySelectorAll<SVGElement>("circle.bubble, [data-trend], [data-bucket]"),
  ).filter((el) => !el.closest("defs"));

  els.forEach((element) => {
    if (!isVisibleShape(element)) return;

    const geometry = getBubbleGeometry(element);
    if (!geometry) return;

    const type = resolveBubbleType(element);
    const color = resolveConnectorColor(type, element);

    const angle = Math.atan2(geometry.cy - frame.cy, geometry.cx - frame.cx);
    const labelRadius = frame.radius - Math.max(frame.radius * 0.09, 28);
    const labelX = frame.cx + Math.cos(angle) * labelRadius;
    const labelY = frame.cy + Math.sin(angle) * labelRadius;

    let rotation = radToDeg(angle);
    if (rotation > 90 || rotation < -90) rotation += 180;

    const key = `${Math.round(geometry.cx)}:${Math.round(geometry.cy)}:${Math.round(geometry.radius * 10) / 10}`;

    const candidate: BubbleCandidate = {
      source: element,
      remove: getBubbleRemovalSet(element),
      cx: geometry.cx,
      cy: geometry.cy,
      radius: geometry.radius,
      type,
      color,
      label: "",
      angle,
      labelX,
      labelY,
      rotation,
    };

    // Keep the one with the bigger removal set if duplicates
    const current = dedupe.get(key);
    if (!current || candidate.remove.length > current.remove.length) {
      dedupe.set(key, candidate);
    }
  });

  const bubbles = Array.from(dedupe.values()).sort((a, b) => a.angle - b.angle);

  if (bubbles.length === 0) warnings.push("No explicit bubble markers were usable.");
  return bubbles;
}

function collectExplicitBubbleGeometries(svg: SVGSVGElement): Array<{ cx: number; cy: number; radius: number }> {
  const els = Array.from(
    svg.querySelectorAll<SVGElement>("circle.bubble, [data-trend], [data-bucket]"),
  ).filter((el) => !el.closest("defs"));

  return els
    .map((el) => getBubbleGeometry(el))
    .filter((g): g is { cx: number; cy: number; radius: number } => Boolean(g && g.radius > 0));
}

function computeRadarFrameFromGeometries(
  bubbles: Array<{ cx: number; cy: number; radius: number }>,
): RadarFrame | null {
  if (bubbles.length === 0) return null;

  const cx = bubbles.reduce((sum, b) => sum + b.cx, 0) / bubbles.length;
  const cy = bubbles.reduce((sum, b) => sum + b.cy, 0) / bubbles.length;

  let maxDist = 0;
  let maxR = 0;
  for (const b of bubbles) {
    maxDist = Math.max(maxDist, distance(cx, cy, b.cx, b.cy));
    maxR = Math.max(maxR, b.radius);
  }

  const padding = 40;
  return { cx, cy, radius: maxDist + maxR + padding };
}

function detectRadarFrame(
  svg: SVGSVGElement,
  viewBox: ViewBox,
  warnings: string[],
  explicitBubbles: Array<{ cx: number; cy: number; radius: number }>
): RadarFrame {
  const circleCandidates = collectFrameCandidates(svg, "circle");
  const ellipseCandidates = collectFrameCandidates(svg, "ellipse");

  const pool =
    circleCandidates.filter((candidate) => candidate.preferred).length > 0
      ? circleCandidates.filter((candidate) => candidate.preferred)
      : circleCandidates.length > 0
        ? circleCandidates
        : ellipseCandidates.filter((candidate) => candidate.preferred).length > 0
          ? ellipseCandidates.filter((candidate) => candidate.preferred)
          : ellipseCandidates;

  if (pool.length > 0) {
    const outer = pool.reduce((best, curr) => (curr.radius > best.radius ? curr : best));
    return { cx: outer.cx, cy: outer.cy, radius: outer.radius };
  }

  const axisIntersection = detectAxisIntersection(svg);
  if (axisIntersection) {
    const radius = computeRadarRadiusFromExplicitBubbles(explicitBubbles, axisIntersection);
    if (radius) {
      return { cx: axisIntersection.cx, cy: axisIntersection.cy, radius };
    }
  }

  const derived = computeRadarFrameFromGeometries(explicitBubbles);
  if (derived) return derived;

  warnings.push("No radar frame ring and no bubbles found; falling back to viewBox.");
  return {
    cx: viewBox.x + viewBox.width / 2,
    cy: viewBox.y + viewBox.height / 2,
    radius: Math.min(viewBox.width, viewBox.height) / 2,
  };
}

function getStyleProperty(element: Element, property: string): string {
  const style = element.getAttribute("style") ?? "";
  const regex = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  const match = style.match(regex);
  return match?.[1]?.trim() ?? "";
}

function getInheritedAttribute(element: Element, attribute: string): string {
  let current: Element | null = element;

  while (current) {
    const fromAttr = current.getAttribute(attribute);
    if (fromAttr) return fromAttr;

    const fromStyle = getStyleProperty(current, attribute);
    if (fromStyle) return fromStyle;

    current = current.parentElement;
    if (current?.tagName.toLowerCase() === "svg") break;
  }

  return "";
}

function isNeutralStrokeColor(strokeRaw: string, element: SVGElement): boolean {
  const stroke = normalizeColor(strokeRaw);
  const strokeOpacity = parseNumber(getInheritedAttribute(element, "stroke-opacity"), 1);

  if (!stroke || stroke === "none") return true;
  if (strokeOpacity <= 0) return true;

  if (
    stroke === "black" ||
    stroke === "white" ||
    stroke === "gray" ||
    stroke === "grey" ||
    stroke === "lightgray" ||
    stroke === "lightgrey" ||
    stroke === "darkgray" ||
    stroke === "darkgrey" ||
    stroke === "#000" ||
    stroke === "#000000" ||
    stroke === "#fff" ||
    stroke === "#ffffff"
  ) {
    return true;
  }

  const shortHex = stroke.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return r === g && g === b;
  }

  const fullHex = stroke.match(/^#([0-9a-f]{6})$/i);
  if (fullHex) {
    const hex = fullHex[1];
    return hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6);
  }

  const rgb = stroke.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]
      .split(",")
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));
    if (parts.length === 3) {
      return parts[0] === parts[1] && parts[1] === parts[2];
    }
  }

  if (stroke.includes("gray") || stroke.includes("grey")) return true;

  return false;
}

function resolveComputedStroke(element: SVGElement): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "-99999px";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";

  try {
    const mountedSvg = document.createElementNS(SVG_NS, "svg");
    const sourceSvg = element.ownerSVGElement;
    if (sourceSvg) {
      sourceSvg.querySelectorAll("style").forEach((style) => {
        mountedSvg.appendChild(style.cloneNode(true));
      });
    }

    const clonedElement = element.cloneNode(true) as SVGElement;
    mountedSvg.appendChild(clonedElement);
    host.appendChild(mountedSvg);
    document.body.appendChild(host);

    return window.getComputedStyle(clonedElement).stroke || "";
  } finally {
    host.remove();
  }
}

function removeOriginalConnectors(svg: SVGSVGElement) {
  svg.querySelectorAll<SVGElement>("line, path, polyline").forEach((element) => {
    if (element.closest("defs")) return;

    const fill = getInheritedAttribute(element, "fill");
    const stroke = getInheritedAttribute(element, "stroke") || resolveComputedStroke(element);
    if (!stroke) return;
    if (isNeutralStrokeColor(stroke, element)) return;

    const tag = element.tagName.toLowerCase();
    if (tag === "line") {
      element.remove();
      return;
    }

    if (!fill || normalizeColor(fill) === "none") {
      element.remove();
    }
  });
}

function getKeywordBag(element: Element): string {
  let current: Element | null = element;
  const tokens: string[] = [];

  while (current) {
    tokens.push(current.id, current.getAttribute("class") ?? "", current.getAttribute("data-type") ?? "");
    for (const attr of Array.from(current.attributes)) {
      if (attr.name.startsWith("data-")) {
        tokens.push(attr.value);
      }
    }

    current = current.parentElement;
    if (current?.tagName.toLowerCase() === "svg") break;
  }

  return tokens.join(" ").toLowerCase();
}

function resolveBubbleType(element: SVGElement): BubbleType {
    // Prefer explicit bucket markers from uploaded trend radar
  const bucket = (element.getAttribute("data-bucket") ?? "").trim();
  if (bucket) {
    const mapped = bubbleBucketTypeMap[bucket as keyof typeof bubbleBucketTypeMap];
    if (mapped) return mapped;
  }
  const bag = getKeywordBag(element);

  if (bag.includes("sehr hoch") || bag.includes("sehr-hoch") || bag.includes("very-high")) {
    return "Sehr hoch";
  }
  if (bag.includes("sehr niedrig") || bag.includes("sehr-niedrig") || bag.includes("very-low")) {
    return "Sehr niedrig";
  }
  if (bag.includes("niedrig") || bag.includes("low")) {
    return "Niedrig";
  }
  if (bag.includes("hoch") || bag.includes("high")) {
    return "Hoch";
  }

  const fill = normalizeColor(getInheritedAttribute(element, "fill"));
  const stroke = normalizeColor(getInheritedAttribute(element, "stroke"));
  const color = fill && fill !== "none" ? fill : stroke;

  if (["#ef9fbf", "#efb0c6", "#f29bbd", "#e17ab2", "#d762a4", "#ff8cb8", "#e59ab5"].includes(color)) {
    return "Sehr hoch";
  }
  if (["#7bd6df", "#78d5d8", "#59c8d3", "#1dc4d4", "#63d5e5", "#99e2e3"].includes(color)) {
    return "Hoch";
  }
  if (["#b7b0db", "#bcb7e8", "#a8a4d6", "#9ba7dd", "#b9c7e9"].includes(color)) {
    return "Niedrig";
  }
  if (["#d3d7da", "#c8d0d6", "#d8ddde", "#dadada", "#e1e4e6", "#b8c2c7"].includes(color)) {
    return "Sehr niedrig";
  }

  return "Hoch";
}

function resolveConnectorColor(type: BubbleType, element: SVGElement): string {
  const fill = normalizeColor(getInheritedAttribute(element, "fill"));
  const stroke = normalizeColor(getInheritedAttribute(element, "stroke"));
  return fill && fill !== "none"
    ? fill
    : stroke && stroke !== "none"
      ? stroke
      : CONNECTOR_COLORS[type];
}

function isVisibleShape(element: SVGElement): boolean {
  const fill = normalizeColor(getInheritedAttribute(element, "fill"));
  const stroke = normalizeColor(getInheritedAttribute(element, "stroke"));
  const opacity = parseNumber(getInheritedAttribute(element, "opacity"), 1);
  const fillOpacity = parseNumber(getInheritedAttribute(element, "fill-opacity"), 1);
  const strokeOpacity = parseNumber(getInheritedAttribute(element, "stroke-opacity"), 1);

  if (opacity <= 0 || (fillOpacity <= 0 && strokeOpacity <= 0)) return false;
  if ((fill === "" || fill === "none") && (stroke === "" || stroke === "none")) return false;

  return true;
}

function getBubbleGeometry(element: SVGElement): { cx: number; cy: number; radius: number } | null {
  const tag = element.tagName.toLowerCase();
  const matrix = getElementMatrix(element);

  if (tag === "circle") {
    const center = applyMatrix(
      { x: parseNumber(element.getAttribute("cx"), 0), y: parseNumber(element.getAttribute("cy"), 0) },
      matrix,
    );
    const radius = transformRadius(parseNumber(element.getAttribute("r"), 0), matrix);
    return radius > 0 ? { cx: center.x, cy: center.y, radius } : null;
  }

  if (tag === "ellipse") {
    const center = applyMatrix(
      { x: parseNumber(element.getAttribute("cx"), 0), y: parseNumber(element.getAttribute("cy"), 0) },
      matrix,
    );
    const radius = transformRadius(
      (parseNumber(element.getAttribute("rx"), 0) + parseNumber(element.getAttribute("ry"), 0)) / 2,
      matrix,
    );
    return radius > 0 ? { cx: center.x, cy: center.y, radius } : null;
  }

  if (tag === "rect") {
    const x = parseNumber(element.getAttribute("x"), 0);
    const y = parseNumber(element.getAttribute("y"), 0);
    const width = parseNumber(element.getAttribute("width"), 0);
    const height = parseNumber(element.getAttribute("height"), 0);
    if (!(width > 0 && height > 0)) return null;

    const center = applyMatrix({ x: x + width / 2, y: y + height / 2 }, matrix);
    const radius = transformRadius(Math.min(width, height) / 2, matrix);
    return radius > 0 ? { cx: center.x, cy: center.y, radius } : null;
  }

  return null;
}

function getBubbleRemovalSet(element: SVGElement): SVGElement[] {
  const parent = element.parentElement;
  if (!parent || parent.tagName.toLowerCase() === "svg") {
    return [element];
  }

  const siblingShapes = Array.from(parent.children).filter((child) => {
    const tag = child.tagName.toLowerCase();
    return tag === "circle" || tag === "ellipse" || tag === "rect";
  });

  return siblingShapes.length > 1
    ? siblingShapes.filter((child): child is SVGElement => child instanceof SVGElement)
    : [element];
}

function collectBubbleCandidates(
  svg: SVGSVGElement,
  frame: RadarFrame,
  warnings: string[],
  explicitBubbles: Array<{ cx: number; cy: number; radius: number }>,
): BubbleCandidate[] {
  const dedupe = new Map<string, BubbleCandidate>();
  const minRadius = Math.max(frame.radius * 0.012, 4);
  const maxRadius = frame.radius * 0.12;

  // Build a tolerant lookup of explicit bubbles (these are the real bubbles)
  const explicitIndex = new Set(explicitBubbles.map((b) => `${Math.round(b.cx)}:${Math.round(b.cy)}`));

  const isNearExplicit = (cx: number, cy: number) => {
    if (explicitIndex.size === 0) return true; // no explicit markers -> don't filter
    const rx = Math.round(cx);
    const ry = Math.round(cy);

    // IMPORTANT: tolerance needs to be bigger than 2px due to transforms/float rounding.
    // 12px neighborhood is still safe and stops decorative dots.
    for (let dx = -12; dx <= 12; dx++) {
      for (let dy = -12; dy <= 12; dy++) {
        if (explicitIndex.has(`${rx + dx}:${ry + dy}`)) return true;
      }
    }
    return false;
  };

  svg.querySelectorAll<SVGElement>("circle, ellipse, rect").forEach((element) => {
    if (element.closest("defs")) return;
    if (!isVisibleShape(element)) return;

    const geometry = getBubbleGeometry(element);
    if (!geometry) return;

    // 🔥 kill false positives: only accept shapes near explicit bubble markers
    if (!isNearExplicit(geometry.cx, geometry.cy)) return;

    if (geometry.radius < minRadius || geometry.radius > maxRadius) return;

    const ringDistance = distance(frame.cx, frame.cy, geometry.cx, geometry.cy);
    if (Math.abs(geometry.radius - frame.radius) < frame.radius * 0.06) return;
    if (ringDistance + geometry.radius > frame.radius * 0.98) return;

    const type = resolveBubbleType(element);
    const color = resolveConnectorColor(type, element);
    const angle = Math.atan2(geometry.cy - frame.cy, geometry.cx - frame.cx);
    const labelRadius = frame.radius - Math.max(frame.radius * 0.09, 28);
    const labelX = frame.cx + Math.cos(angle) * labelRadius;
    const labelY = frame.cy + Math.sin(angle) * labelRadius;

    let rotation = radToDeg(angle);
    if (rotation > 90 || rotation < -90) rotation += 180;

    const key = [
      Math.round(geometry.cx),
      Math.round(geometry.cy),
      Math.round(geometry.radius * 10) / 10,
    ].join(":");

    const candidate: BubbleCandidate = {
      source: element,
      remove: getBubbleRemovalSet(element),
      cx: geometry.cx,
      cy: geometry.cy,
      radius: geometry.radius,
      type,
      color,
      label: "",
      angle,
      labelX,
      labelY,
      rotation,
    };

    const current = dedupe.get(key);
    if (!current || candidate.remove.length > current.remove.length) {
      dedupe.set(key, candidate);
    }
  });

  const bubbles = Array.from(dedupe.values()).sort((left, right) => left.angle - right.angle);

  if (bubbles.length === 0) {
    warnings.push("No radar bubbles were detected in the uploaded SVG.");
  }


  return bubbles;
}

function getTextAnchorPoint(element: SVGTextElement): { x: number; y: number } | null {
  const xAttr = element.getAttribute("x");
  const yAttr = element.getAttribute("y");
  const tspan = element.querySelector("tspan");

  const x = xAttr ?? tspan?.getAttribute("x");
  const y = yAttr ?? tspan?.getAttribute("y");
  if (x == null || y == null) return null;

  const matrix = getElementMatrix(element);
  return applyMatrix({ x: parseNumber(x, 0), y: parseNumber(y, 0) }, matrix);
}

function collectLabelCandidates(svg: SVGSVGElement, frame: RadarFrame): LabelCandidate[] {
  return Array.from(svg.querySelectorAll<SVGTextElement>("text"))
    .map((element) => {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) return null;

      const anchor = getTextAnchorPoint(element);
      if (!anchor) return null;

      const distanceFromCenter = distance(frame.cx, frame.cy, anchor.x, anchor.y);
      // Much more relaxed distance constraints to capture labels anywhere around the perimeter
      if (distanceFromCenter < frame.radius * 0.30 || distanceFromCenter > frame.radius * 1.50) {
        return null;
      }

      return {
        element,
        text,
        x: anchor.x,
        y: anchor.y,
        angle: Math.atan2(anchor.y - frame.cy, anchor.x - frame.cx),
        distance: distanceFromCenter,
      };
    })
    .filter((candidate): candidate is LabelCandidate => Boolean(candidate));
}

function assignLabelsToBubbles(bubbles: BubbleCandidate[], labels: LabelCandidate[], frame: RadarFrame, warnings: string[]) {
  const used = new Set<SVGTextElement>();
  const targetDistance = frame.radius - Math.max(frame.radius * 0.08, 24);

  // Sort bubbles by angle for a more natural assignment
  const bubblesByAngle = [...bubbles].map((b, idx) => ({ bubble: b, originalIndex: idx })).sort((a, b) => a.bubble.angle - b.bubble.angle);

  bubblesByAngle.forEach(({ bubble, originalIndex }) => {
    let best: LabelCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of labels) {
      if (used.has(candidate.element)) continue;

      const delta = angleDelta(candidate.angle, bubble.angle);
      // Much more relaxed angle constraint: allow labels up to ~150 degrees away
      if (delta > (Math.PI * 5) / 6) continue;

      // Score favors angular proximity more, but still considers distance
      const score = delta * frame.radius * 2 + Math.abs(candidate.distance - targetDistance) * 0.5;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    // If no good match in proximity, find the closest label by angle regardless of distance
    if (!best && labels.length > 0) {
      let closestByAngle: LabelCandidate | null = null;
      let smallestDelta = Number.POSITIVE_INFINITY;

      for (const candidate of labels) {
        if (used.has(candidate.element)) continue;
        const delta = angleDelta(candidate.angle, bubble.angle);
        if (delta < smallestDelta) {
          closestByAngle = candidate;
          smallestDelta = delta;
        }
      }
      best = closestByAngle;
    }

    if (!best) {
      // No warnings for missing labels - user can add them via sidebar
      bubble.label = "";
      return;
    }

    used.add(best.element);
    bubble.label = best.text;
  });
}

function ensureDefs(svg: SVGSVGElement): SVGDefsElement {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs as SVGDefsElement;
}

function getFetchedViewBox(svg: SVGSVGElement, warnings: string[], type: BubbleType): string {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox?.trim()) return viewBox.trim();

  const width = parseNumber(svg.getAttribute("width"), 0);
  const height = parseNumber(svg.getAttribute("height"), 0);
  if (width > 0 && height > 0) return `0 0 ${width} ${height}`;

  warnings.push(`Bubble asset "${type}" has no viewBox. Falling back to "0 0 100 100".`);
  return "0 0 100 100";
}

function buildFallbackSymbol(defs: SVGDefsElement, type: BubbleType) {
  const symbol = document.createElementNS(SVG_NS, "symbol");
  symbol.setAttribute("id", bubbleSymbolIds[type]);
  symbol.setAttribute("viewBox", "0 0 100 100");

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "50");
  circle.setAttribute("cy", "50");
  circle.setAttribute("r", "46");
  circle.setAttribute("fill", CONNECTOR_COLORS[type]);
  circle.setAttribute("fill-opacity", "0.92");
  circle.setAttribute("stroke", "#ffffff");
  circle.setAttribute("stroke-opacity", "0.75");
  circle.setAttribute("stroke-width", "2");

  symbol.appendChild(circle);
  defs.appendChild(symbol);
}

async function injectBubbleSymbol(defs: SVGDefsElement, type: BubbleType, warnings: string[]) {
  const symbolId = bubbleSymbolIds[type];
  if (defs.querySelector(`#${symbolId}`)) return;

  try {
    const response = await fetch(bubbleAssetUrls[type]);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const svgText = await response.text();
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const sourceSvg = parsed.querySelector("svg");

    if (!sourceSvg) {
      throw new Error("No <svg> root in asset.");
    }

    const symbol = document.createElementNS(SVG_NS, "symbol");
    symbol.setAttribute("id", symbolId);
    symbol.setAttribute("viewBox", getFetchedViewBox(sourceSvg, warnings, type));

    Array.from(sourceSvg.childNodes).forEach((child) => {
      symbol.appendChild(document.importNode(child, true));
    });

    defs.appendChild(symbol);
  } catch (error) {
    warnings.push(
      `Failed to fetch bubble asset "${bubbleAssetUrls[type]}". Using a fallback vector bubble instead.`,
    );
    buildFallbackSymbol(defs, type);
    console.error(error);
  }
}

function removeEmptyGroups(svg: SVGSVGElement) {
  let changed = true;

  while (changed) {
    changed = false;
    svg.querySelectorAll<SVGGElement>("g").forEach((group) => {
      if (!group.querySelector("*") && !group.textContent?.trim()) {
        group.remove();
        changed = true;
      }
    });
  }
}

function createRadarClip(defs: SVGDefsElement, frame: RadarFrame) {
  const clipId = "trend-radar-clip";
  defs.querySelector(`#${clipId}`)?.remove();

  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", clipId);
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(frame.cx));
  circle.setAttribute("cy", String(frame.cy));
  circle.setAttribute("r", String(frame.radius * 1.3));

  clipPath.appendChild(circle);
  defs.appendChild(clipPath);
  return clipId;
}

function wrapStage(svg: SVGSVGElement, clipId: string) {
  svg.querySelector(".fl-radar-stage")?.remove();
  svg.querySelector(".fl-radar-overlay")?.remove();

  const stage = document.createElementNS(SVG_NS, "g");
  stage.classList.add("fl-radar-stage");
  stage.setAttribute("clip-path", `url(#${clipId})`);

  const nodesToMove = Array.from(svg.childNodes).filter((node) => {
    if (!(node instanceof Element)) return false;
    const tag = node.tagName.toLowerCase();
    return tag !== "defs" && tag !== "style";
  });

  nodesToMove.forEach((node) => stage.appendChild(node));
  svg.appendChild(stage);

  const overlay = document.createElementNS(SVG_NS, "g");
  overlay.classList.add("fl-radar-overlay");
  overlay.setAttribute("clip-path", `url(#${clipId})`);
  svg.appendChild(overlay);

  return { stage, overlay };
}

function injectSvgStyle(svg: SVGSVGElement) {
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = `
    .fl-trend-radar {
      color: #202020;
      overflow: visible;
      background-color: transparent;
    }
    .fl-trend-radar * {
      vector-effect: non-scaling-stroke;
    }
    .fl-trend-radar .radar-bubble {
      cursor: pointer;
    }
    .fl-trend-radar .radar-bubble-use {
      transition: filter 200ms ease, opacity 200ms ease;
    }
    .fl-trend-radar .radar-bubble.is-selected .radar-bubble-use {
      filter: drop-shadow(0 4px 12px rgba(17, 24, 39, 0.15));
    }
    .fl-trend-radar .radar-bubble:hover .radar-bubble-use {
      filter: brightness(1.05);
    }
    .fl-trend-radar .radar-connector {
      fill: none;
      stroke-width: 1;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.6;
      pointer-events: none;
    }
    .fl-trend-radar .radar-bubble-label {
      fill: #202020;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.01em;
      pointer-events: none;
      user-select: none;
      text-transform: capitalize;
    }
  `;

  svg.appendChild(style);
}

function buildBubbleNode(svg: SVGSVGElement, bubble: BubbleCandidate, index: number, bubbleFrame: RadarFrame) {
  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("radar-bubble");
  group.setAttribute("data-bubble-id", `radar-bubble-${index + 1}`);
  group.setAttribute("data-bubble-label", bubble.label);
  group.setAttribute("data-bubble-type", bubble.type);
  group.setAttribute("data-cx", String(bubble.cx));
  group.setAttribute("data-cy", String(bubble.cy));
  group.setAttribute("data-radius", String(bubble.radius));
  group.setAttribute("data-angle", String(bubble.angle));

const connector = document.createElementNS(SVG_NS, "path");
connector.classList.add("radar-connector");

const x1 = bubble.cx;
const y1 = bubble.cy;
const x2 = bubble.labelX;
const y2 = bubble.labelY;

// midpoint
const midX = (x1 + x2) / 2;
const midY = (y1 + y2) / 2;

// push curve outward along bubble angle
const nx = Math.cos(bubble.angle);
const ny = Math.sin(bubble.angle);

// tweak this if you want stronger curve
const bend = Math.max(18, bubbleFrame.radius * 0.08);

const cx = midX + nx * bend;
const cy = midY + ny * bend;

// quadratic bezier curve
connector.setAttribute("d", `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
connector.setAttribute("stroke", bubble.color);

  const use = document.createElementNS(SVG_NS, "use");
  use.classList.add("radar-bubble-use");
  const href = `#${bubbleSymbolIds[bubble.type]}`;
  use.setAttribute("href", href);
  use.setAttributeNS(XLINK_NS, "xlink:href", href);
  // --- bubble sizing: make symbol slightly smaller than source radius
// This prevents glossy SVG assets from visually "spilling" outside rings.
const BUBBLE_VISUAL_SCALE = 0.88; // tweak 0.84–0.92 if needed

// Clamp radius so bubbles never exceed the radar frame edge
const distFromCenter = Math.hypot(bubble.cx - bubbleFrame.cx, bubble.cy - bubbleFrame.cy);
const maxAllowed = Math.max(2, bubbleFrame.radius * 0.98 - distFromCenter); // keep a small margin
const r = Math.min(bubble.radius, maxAllowed) * BUBBLE_VISUAL_SCALE;

use.setAttribute("x", String(bubble.cx - r));
use.setAttribute("y", String(bubble.cy - r));
use.setAttribute("width", String(r * 2));
use.setAttribute("height", String(r * 2));
  use.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const text = document.createElementNS(SVG_NS, "text");
  text.classList.add("radar-bubble-label");
  text.setAttribute("x", String(bubble.labelX));
  text.setAttribute("y", String(bubble.labelY));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("transform", `rotate(${bubble.rotation} ${bubble.labelX} ${bubble.labelY})`);
  text.textContent = bubble.label;

  group.appendChild(connector);
  group.appendChild(use);
  group.appendChild(text);

  if (index === 0) {
    group.classList.add("is-selected");
  }

  return group;
}

function spreadLabels(bubbles: BubbleCandidate[], frame: RadarFrame) {
  if (bubbles.length <= 1) return;

  // Labels live just outside the radar frame
  const baseR = frame.radius - Math.max(frame.radius * 0.08, 28);

  // Sort by angle so we can push neighbors apart
  const sorted = [...bubbles].sort((a, b) => a.angle - b.angle);

  // Minimum angular gap depends on label length and desired spacing
  const minGapFor = (label: string) => {
    const chars = Math.max(3, (label || "").length);
    // Calculate minimum pixels needed based on character count
    const px = Math.min(200, chars * 8);
    const r = baseR;
    // Convert pixel width to radians at this radius
    // Add extra padding for readability
    return (px / Math.max(1, r)) + 0.05; // radians
  };

  // Forward pass: push each label away from previous if too close
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const minGap = Math.max(minGapFor(prev.label), minGapFor(cur.label), 0.12); // increased hard minimum

    let delta = cur.angle - prev.angle;
    if (delta < minGap) {
      cur.angle = prev.angle + minGap;
    }
  }

  // Backward pass: prevent wraparound and keep labels balanced
  for (let i = sorted.length - 2; i >= 0; i--) {
    const next = sorted[i + 1];
    const cur = sorted[i];
    const minGap = Math.max(minGapFor(cur.label), minGapFor(next.label), 0.12);

    let delta = next.angle - cur.angle;
    if (delta < minGap) {
      cur.angle = next.angle - minGap;
    }
  }

  // Check for wraparound and adjust if needed
  const firstAngle = sorted[0].angle;
  const lastAngle = sorted[sorted.length - 1].angle;
  const wrapDelta = firstAngle + Math.PI * 2 - lastAngle;
  const minGapWrap = Math.max(minGapFor(sorted[sorted.length - 1].label), minGapFor(sorted[0].label), 0.12);
  
  if (wrapDelta < minGapWrap && wrapDelta > 0) {
    // Shift all angles backward slightly to create space
    const shift = (minGapWrap - wrapDelta) / 2;
    for (const b of sorted) {
      b.angle -= shift;
    }
  }

  // Apply final label positions/rotations
  for (const b of bubbles) {
    b.labelX = frame.cx + Math.cos(b.angle) * baseR;
    b.labelY = frame.cy + Math.sin(b.angle) * baseR;

    // Calculate rotation to make text readable
    let rotation = (b.angle * 180) / Math.PI;
    // Flip text if it would be upside down
    if (rotation > 90 || rotation < -90) rotation += 180;
    b.rotation = rotation;
  }
}

export async function transformTrendRadarHtmlToStyledSvg(
  htmlText: string,
  _options?: RadarTransformOptions,
): Promise<RadarTransformResult> {
  const warnings: string[] = [];

  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  stripScriptsAndEventHandlers(doc.documentElement);

  const svg = selectRadarSvg(doc);
  if (!svg) {
    return { bubbles: [], svg: "", warnings: ["No <svg> found in the uploaded HTML."] };
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  stripScriptsAndEventHandlers(clone);

const viewBox = ensureViewBox(clone, warnings);

const explicitBubbleGeoms = collectExplicitBubbleGeometries(clone);
const frame = detectRadarFrame(clone, viewBox, warnings, explicitBubbleGeoms);
removeOriginalConnectors(clone);

  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  clone.setAttribute("class", `${clone.getAttribute("class") ?? ""} fl-trend-radar`.trim());

  const labels = collectLabelCandidates(clone, frame);

const bubbles =
  explicitBubbleGeoms.length > 0
    ? collectExplicitBubbleCandidates(clone, frame, warnings, explicitBubbleGeoms)
    : collectBubbleCandidates(clone, frame, warnings, explicitBubbleGeoms);
  assignLabelsToBubbles(bubbles, labels, frame, warnings);
  spreadLabels(bubbles, frame);

  
  clone.querySelectorAll("text").forEach((text) => text.remove());

  const uniqueRemovals = new Set<SVGElement>();
  bubbles.forEach((bubble) => bubble.remove.forEach((element) => uniqueRemovals.add(element)));
  uniqueRemovals.forEach((element) => element.remove());

  removeEmptyGroups(clone);

  const defs = ensureDefs(clone);
  await Promise.all(
    bubbleTypes.map((type) => injectBubbleSymbol(defs, type, warnings)),
  );

  const clipId = createRadarClip(defs, frame);
  const { overlay } = wrapStage(clone, clipId);

  bubbles.forEach((bubble, index) => {
    overlay.appendChild(buildBubbleNode(clone, bubble, index, frame));
  });

  // Only warn if we have bubbles but completely failed to extract any labels from the SVG
  const extractedLabels = bubbles.filter((b) => b.label).length;
  if (bubbles.length > 0 && extractedLabels === 0) {
    warnings.push("No text labels found in the source SVG. Use the sidebar to add bubble labels.");
  }

  injectSvgStyle(clone);

  const output = new XMLSerializer().serializeToString(clone);
  if (!output.includes("radar-bubble-use")) {
    warnings.push("Bubble symbol replacement did not complete. No radar bubble <use> elements were found in output.");
  }

  return {
    bubbles: bubbles.map((bubble, index) => ({
      id: `radar-bubble-${index + 1}`,
      label: bubble.label,
      type: bubble.type,
    })),
    svg: output,
    warnings,
  };
}
