// lib/radar/transformTrendRadarHtml.ts

import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { BubbleAssetMap, BubbleOverride, BubbleType } from "@/lib/radar/radarConfig";

type NodeHandle = any;
type CheerioElement = NodeHandle;
type Point = { x: number; y: number };

type NormalizedBubble = {
  node: Cheerio<CheerioElement>;
  tagName: string;
  cx: number;
  cy: number;
  r: number;
  clusterId: string | null;
  bucket: string | null;
  label: string | null;
  fillRaw: string | null;
  resolvedType: BubbleType | null;
};

type TransformResult = {
  svg: string;
  bubbles: Array<{ id: string; label: string; type: BubbleType }>;
  warnings: string[];
};

type TransformOptions = {
  bubbleAssets: BubbleAssetMap;
  logoAsset: string;
  overrides: Record<string, BubbleOverride>;
  selectedBubbleId: string | null;
};

const RADAR_TRANSFORM_ENABLED = true;

type LineSeg = {
  el: NodeHandle;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
};

type Phase1Meta = {
  center: Point;
  frameRadius: number;
  ringCount: number;
  axisCount: number;
  source: {
    centerFrom: "rings" | "axisIntersection" | "viewBox";
    radiusFrom: "outerRing" | "viewBox";
  };
};

const TEAL_HEXES = new Set(["#18bea9", "#0674b0"]);
const WHITE_HEXES = new Set(["#ffffff", "#fff"]);
type BucketKey = "1" | "2" | "3" | "4";
const bucketBubbleTypeMap: Record<BucketKey, BubbleType> = {
  "1": "Sehr niedrig",
  "2": "Niedrig",
  "3": "Hoch",
  "4": "Sehr hoch",
};
const bubbleTypeAssetMap: Record<BubbleType, string> = {
  "Sehr hoch": "/radar-bubbles/sehr-hoch.svg",
  Hoch: "/radar-bubbles/hoch.svg",
  Niedrig: "/radar-bubbles/niedrig.svg",
  "Sehr niedrig": "/radar-bubbles/sehr-niedrig.svg",
};
const bubbleTypeConnectorStrokeMap: Record<BubbleType, string> = {
  "Sehr hoch": "#0674B0",
  Hoch: "#18BEA9",
  Niedrig: "#7B61FF",
  "Sehr niedrig": "#FF4DA6",
};

function toNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function toSvgCoord(v: string | undefined): number | null {
  if (!v) return null;
  const token = String(v).trim().split(/[\s,]+/)[0];
  if (!token) return null;
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function normHex(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function collectNormalizedBubbles(
  $: CheerioAPI,
  svg: Cheerio<CheerioElement>,
  warnings: string[],
): NormalizedBubble[] {
  const bubbles: NormalizedBubble[] = [];

  const nodes = svg
    .find(
      [
        "circle.bubble",
        "circle.trend-bubble",
        "circle[data-trend]",
        "circle[data-bucket]",
        'circle[class*="bucket"]',
        "image.bubble",
      ].join(", "),
    )
    .filter((_, el) => !$(el).hasClass("bubble-hit"));

  nodes.each((_, el) => {
    const node = $(el);
    const tagName = ((el as { name?: string }).name ?? "").toLowerCase();

    let cx: number | null = null;
    let cy: number | null = null;
    let r: number | null = null;

    if (tagName === "image") {
      const x = toNum(node.attr("x"));
      const y = toNum(node.attr("y"));
      const w = toNum(node.attr("width"));
      const h = toNum(node.attr("height"));
      if (x == null || y == null || w == null || h == null) {
        warnings.push(
          `Bubble <image> missing x/y/width/height; skipped. attrs=${JSON.stringify(
            (el as { attribs?: Record<string, string> }).attribs ?? {},
          )}`,
        );
        return;
      }
      cx = x + w / 2;
      cy = y + h / 2;
      r = Math.min(w, h) / 2;
    } else {
      cx = toNum(node.attr("cx"));
      cy = toNum(node.attr("cy"));
      r =
        toNum(node.attr("data-radius-px") ?? undefined) ??
        toNum(node.attr("data-radius") ?? undefined) ??
        toNum(node.attr("r") ?? undefined);

      if (cx == null || cy == null || r == null) {
        warnings.push(
          `Bubble missing cx/cy/r; skipped. attrs=${JSON.stringify(
            (el as { attribs?: Record<string, string> }).attribs ?? {},
          )}`,
        );
        return;
      }
    }

    const clusterId =
      node.attr("data-cluster-id") ??
      node.attr("data-cluster") ??
      node.attr("data-clusterid") ??
      null;

    const bucket = getBucketFromNode(node as unknown as Cheerio<NodeHandle>) ?? null;

    const siblingText = node.next();
    const siblingLabel =
      siblingText.length > 0 && siblingText.is("text")
        ? (siblingText.text() ?? "").replace(/\s+/g, " ").trim()
        : "";
    const labelRaw = node.attr("data-trend") ?? siblingLabel;
    const label = labelRaw.replace(/\s+/g, " ").trim() || null;

    if (!label) {
      warnings.push(
        `Bubble missing data-trend; label will be null. clusterId=${clusterId ?? "unknown"}`,
      );
    }

    const fillRaw = node.attr("fill") ?? null;
    const resolvedType =
      (bucket ? bucketBubbleTypeMap[bucket] : null) ??
      getBubbleTypeFromFill(fillRaw ?? undefined);

    bubbles.push({
      node: node as unknown as Cheerio<CheerioElement>,
      tagName: tagName || "circle",
      cx,
      cy,
      r,
      clusterId,
      bucket,
      label,
      fillRaw,
      resolvedType,
    });
  });

  // ── Normalize bubble radii so the largest bubble matches TARGET_MAX_R ──
  const TARGET_MAX_R = 25; // tunable: desired max bubble radius in output space
  const maxInputR = Math.max(...bubbles.map((b) => b.r), 1);
  const radiusScale = TARGET_MAX_R / maxInputR;

  console.log(`[collectNormalizedBubbles] maxInputR=${maxInputR.toFixed(2)}, radiusScale=${radiusScale.toFixed(4)}`);

  bubbles.forEach((b) => {
    b.r = b.r * radiusScale;
  });

  warnings.push(`Normalized bubbles found: ${bubbles.length}`);

  return bubbles;
}

function getViewBox(svg: Cheerio<NodeHandle>) {
  const vb = svg.attr("viewBox");
  if (!vb) return null;
  const parts = vb.split(/[\s,]+/).map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = parts;
  return { minX, minY, width, height };
}

function viewBoxCenter(svg: Cheerio<NodeHandle>): Point {
  const vb = getViewBox(svg);
  if (vb) return { x: vb.minX + vb.width / 2, y: vb.minY + vb.height / 2 };

  const w = toNum(svg.attr("width")) ?? 0;
  const h = toNum(svg.attr("height")) ?? 0;
  return { x: w / 2, y: h / 2 };
}

function approxViewBoxRadius(svg: Cheerio<NodeHandle>): number {
  const vb = getViewBox(svg);
  if (vb) return Math.min(vb.width, vb.height) / 2;

  const w = toNum(svg.attr("width")) ?? 0;
  const h = toNum(svg.attr("height")) ?? 0;
  return Math.min(w, h) / 2;
}

function isLikelyRingStroke(stroke: string) {
  const s = normHex(stroke);
  if (!s) return false;
  if (TEAL_HEXES.has(s)) return true;
  // permissive for grey-ish hexes (Phase 1 detection only)
  if (s.startsWith("#") && s.length === 7) return true;
  return false;
}

const BLACK_STROKES = new Set(["#000", "#000000", "black"]);

function isAxisStroke(stroke: string) {
  const s = normHex(stroke);
  if (!s) return false;
  if (WHITE_HEXES.has(s)) return true;
  if (BLACK_STROKES.has(s)) return true;
  // handle rgb(0,0,0) / rgb(255,255,255)
  if (s.startsWith("rgb(")) {
    const m = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!m) return false;
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    if ([r, g, b].some((n) => !Number.isFinite(n))) return false;
    const isWhite = r >= 250 && g >= 250 && b >= 250;
    const isBlack = r <= 5 && g <= 5 && b <= 5;
    return isWhite || isBlack;
  }
  return false;
}

function collectRingCandidates($: CheerioAPI, svg: Cheerio<NodeHandle>) {
  const circles = svg.find("circle").toArray();
  const ellipses = svg.find("ellipse").toArray();
  const paths = svg
    .find("path")
    .toArray()
    .filter((node) => {
      const $el = $(node as NodeHandle);
      const id = ($el.attr("id") ?? "").toLowerCase();
      const cls = ($el.attr("class") ?? "").toLowerCase();
      if (id.includes("ring") || cls.includes("ring")) return true;

      const stroke = $el.attr("stroke") ?? "";
      return isLikelyRingStroke(stroke);
    });

  const isStrokeOnly = (node: NodeHandle) => {
    const $el = $(node);
    const stroke = $el.attr("stroke");
    if (!stroke) return false;

    const fill = normHex($el.attr("fill"));
    if (fill && fill !== "none" && fill !== "transparent") return false;
    return true;
  };

  return {
    circles: circles.filter((n) => isStrokeOnly(n as NodeHandle)) as NodeHandle[],
    ellipses: ellipses.filter((n) => isStrokeOnly(n as NodeHandle)) as NodeHandle[],
    paths: paths.filter((n) => isStrokeOnly(n as NodeHandle)) as NodeHandle[],
  };
}

function computeCenterFromRings(
  $: CheerioAPI,
  rings: { circles: NodeHandle[]; ellipses: NodeHandle[] }
) {
  const centers: Point[] = [];

  for (const c of rings.circles) {
    const $c = $(c);
    const cx = toNum($c.attr("cx"));
    const cy = toNum($c.attr("cy"));
    if (cx != null && cy != null) centers.push({ x: cx, y: cy });
  }

  for (const e of rings.ellipses) {
    const $e = $(e);
    const cx = toNum($e.attr("cx"));
    const cy = toNum($e.attr("cy"));
    if (cx != null && cy != null) centers.push({ x: cx, y: cy });
  }

  if (centers.length === 0) return null;

  const xs = centers.map((p) => p.x).sort((a, b) => a - b);
  const ys = centers.map((p) => p.y).sort((a, b) => a - b);
  const mid = Math.floor(centers.length / 2);
  return { x: xs[mid], y: ys[mid] };
}

function computeOuterRingRadius(
  $: CheerioAPI,
  rings: { circles: NodeHandle[]; ellipses: NodeHandle[] },
  center: Point
): number | null {
  let best: number | null = null;

  for (const c of rings.circles) {
    const $c = $(c);
    const cx = toNum($c.attr("cx"));
    const cy = toNum($c.attr("cy"));
    const r = toNum($c.attr("r"));
    if (cx == null || cy == null || r == null) continue;

    const dx = Math.abs(cx - center.x);
    const dy = Math.abs(cy - center.y);
    if (dx > 2 || dy > 2) continue;

    if (best == null || r > best) best = r;
  }

  if (best != null) return best;

  for (const e of rings.ellipses) {
    const $e = $(e);
    const cx = toNum($e.attr("cx"));
    const cy = toNum($e.attr("cy"));
    const rx = toNum($e.attr("rx"));
    const ry = toNum($e.attr("ry"));
    if (cx == null || cy == null || rx == null || ry == null) continue;

    const dx = Math.abs(cx - center.x);
    const dy = Math.abs(cy - center.y);
    if (dx > 2 || dy > 2) continue;

    const r = Math.max(rx, ry);
    if (best == null || r > best) best = r;
  }

  return best;
}

function collectAxisLineCandidates($: CheerioAPI, svg: Cheerio<NodeHandle>): LineSeg[] {
  const lines = svg.find("line").toArray();
  const segs: LineSeg[] = [];

  for (const node of lines) {
    const $el = $(node as NodeHandle);
    const stroke = $el.attr("stroke") ?? "";
    if (!isAxisStroke(stroke)) continue;

    const x1 = toNum($el.attr("x1"));
    const y1 = toNum($el.attr("y1"));
    const x2 = toNum($el.attr("x2"));
    const y2 = toNum($el.attr("y2"));
    if (x1 == null || y1 == null || x2 == null || y2 == null) continue;

    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 10) continue;

    segs.push({ el: node as NodeHandle, x1, y1, x2, y2, len });
  }

  segs.sort((a, b) => b.len - a.len);
  return segs;
}

function lineIntersectionInfinite(a: LineSeg, b: LineSeg): Point | null {
  const x1 = a.x1, y1 = a.y1, x2 = a.x2, y2 = a.y2;
  const x3 = b.x1, y3 = b.y1, x4 = b.x2, y4 = b.y2;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;

  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: px, y: py };
}

function computeCenterFromAxes(svg: Cheerio<NodeHandle>, axes: LineSeg[]) {
  const vb = getViewBox(svg);
  const fallback = viewBoxCenter(svg);

  if (axes.length < 2) return null;

  for (let i = 0; i < Math.min(axes.length, 6); i++) {
    for (let j = i + 1; j < Math.min(axes.length, 6); j++) {
      const p = lineIntersectionInfinite(axes[i], axes[j]);
      if (!p) continue;

      if (vb) {
        const inside =
          p.x >= vb.minX - 5 &&
          p.x <= vb.minX + vb.width + 5 &&
          p.y >= vb.minY - 5 &&
          p.y <= vb.minY + vb.height + 5;
        if (!inside) continue;
      }

      const d = Math.hypot(p.x - fallback.x, p.y - fallback.y);
      const maxD = approxViewBoxRadius(svg) * 0.5;
      if (d > maxD) continue;

      return p;
    }
  }

  return null;
}

function annotateSvg(svg: Cheerio<NodeHandle>, meta: Phase1Meta) {
  svg.attr("data-radar-center-x", String(meta.center.x));
  svg.attr("data-radar-center-y", String(meta.center.y));
  svg.attr("data-radar-frame-radius", String(meta.frameRadius));
  svg.attr("data-radar-ring-count", String(meta.ringCount));
  svg.attr("data-radar-axis-count", String(meta.axisCount));
  svg.attr("data-radar-center-from", meta.source.centerFrom);
  svg.attr("data-radar-radius-from", meta.source.radiusFrom);
}

function ensureBackgroundRings(svg: Cheerio<NodeHandle>, meta: Phase1Meta) {
const tealR3 = meta.frameRadius;        // normalized: teal outer boundary = frame
const tealR2 = meta.frameRadius * 0.74; // from reference proportions
const tealR1 = meta.frameRadius * 0.47; // from reference proportions
const greyR  = meta.frameRadius * 1.45; // wider label band like design

  svg.attr("overflow", "visible");
  const style = svg.attr("style") ?? "";
  if (!/overflow\s*:\s*visible/i.test(style)) {
    svg.attr("style", `${style}${style && !style.trim().endsWith(";") ? ";" : ""}overflow:visible`);
  }

  svg.attr("data-radar-teal-r1", String(tealR1));
  svg.attr("data-radar-teal-r2", String(tealR2));
  svg.attr("data-radar-teal-r3", String(tealR3));
  svg.attr("data-radar-grey-r", String(greyR));

  if (svg.children('g[data-radar-rings="true"]').length) return;

  const cx = meta.center.x;
  const cy = meta.center.y;
  svg.prepend(
    `<g data-radar-rings="true">` +
      `<circle cx="${cx}" cy="${cy}" r="${greyR}" fill="#F0F7F7"></circle>` +
      `<circle cx="${cx}" cy="${cy}" r="${tealR3}" fill="#E6F4F1" stroke="#FFFFFF" stroke-width="2" vector-effect="non-scaling-stroke"></circle>` +
      `<circle cx="${cx}" cy="${cy}" r="${tealR2}" fill="#E6F4F1" stroke="#FFFFFF" stroke-width="2" vector-effect="non-scaling-stroke"></circle>` +
      `<circle cx="${cx}" cy="${cy}" r="${tealR1}" fill="#E6F4F1" stroke="#FFFFFF" stroke-width="2" vector-effect="non-scaling-stroke"></circle>` +
    `</g>`,
  );
}


function ensurePwlgLabelsAndPercents(
  $: CheerioAPI,
  svgEl: Cheerio<NodeHandle>,
  meta: Phase1Meta,
) {
  const cx = meta.center.x;
  const cy = meta.center.y;
  const greyR =
    Number.parseFloat(svgEl.attr("data-radar-grey-r") ?? "") ||
    meta.frameRadius * 1.45;

  let defs = svgEl.children("defs").first();
  if (!defs.length) {
    defs = $("<defs></defs>") as Cheerio<NodeHandle>;
    svgEl.prepend(defs);
  }

  if (!defs.children("linearGradient#fl-tealGradient").length) {
    const gradient = $(
      '<linearGradient id="fl-tealGradient" x1="0%" y1="0%" x2="100%" y2="0%">' +
        '<stop offset="0%" stop-color="#18BEA9"></stop>' +
        '<stop offset="100%" stop-color="#0674B0"></stop>' +
      "</linearGradient>",
    );
    defs.append(gradient);
  }

  svgEl.find("text").toArray().forEach((node) => {
    const textNode = $(node);
    const value = (textNode.text() ?? "").replace(/\s+/g, "").trim();
    if (!/^[PWGL]$/.test(value)) return;
    if ((textNode.attr("dominant-baseline") ?? "").trim().toLowerCase() !== "middle") return;
    if ((textNode.attr("text-anchor") ?? "").trim().toLowerCase() !== "middle") return;
    textNode.remove();
  });

  svgEl.children("#radar-pwlg").remove();
  const group = $('<g id="radar-pwlg"></g>');

  const entries: Array<{
    label: string; percent: string; theta: number;
    anchor: "start" | "middle" | "end"; rotation: number;
  }> = [
    { label: "Wirtschaft", percent: "30%", theta: -Math.PI / 2, anchor: "middle", rotation: 0 },
    { label: "Politik", percent: "31%", theta: Math.PI, anchor: "middle", rotation: -90 },
    { label: "Legitimation", percent: "26%", theta: 0, anchor: "middle", rotation: 90 },
    { label: "Gesellschaft", percent: "13%", theta: Math.PI / 2, anchor: "middle", rotation: 0 },
  ];

  const labelRadius = greyR + 16;
  const percentRadius = greyR + 40;
  const STACK_OFFSET = 16; // half-gap between stacked percent + label for rotated entries

  entries.forEach((entry) => {
    const isRotated = entry.rotation !== 0;

    let labelX: number, labelY: number, percentX: number, percentY: number;

    if (isRotated) {
      // For rotated entries (left/right), position at a single radial point
      // and offset horizontally so that after rotation they stack vertically
      // (percent above, label below)
      const sideRadius = (labelRadius + percentRadius) / 2;
      const baseX = cx + sideRadius * Math.cos(entry.theta);
      const baseY = cy;

      if (entry.rotation === -90) {
        // Left side: rotate(-90) maps (x+d, y) → (x, y-d)
        // percent closer to center (+d) → appears above after rotation
        percentX = baseX + STACK_OFFSET;
        percentY = baseY;
        labelX = baseX - STACK_OFFSET;
        labelY = baseY;
      } else {
        // Right side: rotate(90) maps (x-d, y) → (x, y-d)
        // percent closer to center (-d) → appears above after rotation
        percentX = baseX - STACK_OFFSET;
        percentY = baseY;
        labelX = baseX + STACK_OFFSET;
        labelY = baseY;
      }
    } else {
      // Top/bottom: no rotation, place radially as before
      labelX = cx + labelRadius * Math.cos(entry.theta);
      labelY = cy + labelRadius * Math.sin(entry.theta);
      percentX = cx + percentRadius * Math.cos(entry.theta);
      percentY = cy + percentRadius * Math.sin(entry.theta);
    }

    const labelText = $("<text></text>");
    labelText.attr("x", String(labelX));
    labelText.attr("y", String(labelY));
    labelText.attr("text-anchor", entry.anchor);
    labelText.attr("dominant-baseline", "middle");
    labelText.attr("font-family", "Montserrat, sans-serif");
    labelText.attr("font-size", "24");
    labelText.attr("font-weight", "500");
    labelText.attr("fill", "#111");
    if (isRotated) {
      labelText.attr("transform", `rotate(${entry.rotation}, ${labelX}, ${labelY})`);
    }
    labelText.text(entry.label);
    group.append(labelText);

    const percentText = $("<text></text>");
    percentText.attr("x", String(percentX));
    percentText.attr("y", String(percentY));
    percentText.attr("text-anchor", entry.anchor);
    percentText.attr("dominant-baseline", "middle");
    percentText.attr("font-family", "Montserrat, sans-serif");
    percentText.attr("font-size", "24");
    percentText.attr("font-weight", "700");
    percentText.attr("fill", "url(#fl-tealGradient)");
    if (isRotated) {
      percentText.attr("transform", `rotate(${entry.rotation}, ${percentX}, ${percentY})`);
    }
    percentText.text(entry.percent);
    group.append(percentText);
  });

  svgEl.append(group);
}

function ensureDottedOutlineWithGaps(
  $: CheerioAPI,
  svgEl: Cheerio<NodeHandle>,
  meta: Phase1Meta,
) {
  const cx = meta.center.x;
  const cy = meta.center.y;
  const greyR =
    Number.parseFloat(svgEl.attr("data-radar-grey-r") ?? "") ||
    meta.frameRadius * 1.45;
  const R = greyR + 40;
  const circumference = 2 * Math.PI * R;
  const gapAngle = (36 / circumference) * 2 * Math.PI;

  let defs = svgEl.children("defs").first();
  if (!defs.length) {
    defs = $("<defs></defs>") as Cheerio<NodeHandle>;
    svgEl.prepend(defs);
  }
  if (!defs.children("linearGradient#fl-tealGradient").length) {
    defs.append(
      $(
        '<linearGradient id="fl-tealGradient" x1="0%" y1="0%" x2="100%" y2="0%">' +
          '<stop offset="0%" stop-color="#18BEA9"></stop>' +
          '<stop offset="100%" stop-color="#0674B0"></stop>' +
        "</linearGradient>",
      ),
    );
  }

  svgEl.find("#radar-dotted-outline").remove();
  const group = $('<g id="radar-dotted-outline" pointer-events="none"></g>');

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // 8 gaps: 4 diagonal (logos) + 4 cardinal (PWLG text)
  const logoGapHalf = gapAngle / 2;
  const horizTextGapHalf = (80 / R); // top/bottom horizontal PWLG text
  const rotTextGapHalf = (40 / R);   // left/right rotated PWLG text

  const gaps: Array<{ center: number; halfAngle: number }> = [
    { center: toRad(0),   halfAngle: rotTextGapHalf },    // right (Legitimation)
    { center: toRad(45),  halfAngle: logoGapHalf },        // logo
    { center: toRad(90),  halfAngle: horizTextGapHalf },   // bottom (Gesellschaft)
    { center: toRad(135), halfAngle: logoGapHalf },        // logo
    { center: toRad(180), halfAngle: rotTextGapHalf },     // left (Politik)
    { center: toRad(225), halfAngle: logoGapHalf },        // logo
    { center: toRad(270), halfAngle: horizTextGapHalf },   // top (Wirtschaft)
    { center: toRad(315), halfAngle: logoGapHalf },        // logo
  ];

  // Build arc segments between consecutive gaps
  const segments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < gaps.length; i++) {
    const j = (i + 1) % gaps.length;
    const start = gaps[i].center + gaps[i].halfAngle;
    let end = gaps[j].center - gaps[j].halfAngle;
    if (end <= start) end += Math.PI * 2; // wrap-around for last segment
    segments.push({ start, end });
  }

  const pointAt = (angle: number) => ({
    x: cx + R * Math.cos(angle),
    y: cy + R * Math.sin(angle),
  });

  segments.forEach((segment) => {
    const p1 = pointAt(segment.start);
    const p2 = pointAt(segment.end);
    const delta = segment.end - segment.start;
    const largeArcFlag = delta > Math.PI ? 1 : 0;

    const path = $("<path></path>");
    path.attr("d", `M ${p1.x} ${p1.y} A ${R} ${R} 0 ${largeArcFlag} 1 ${p2.x} ${p2.y}`);
    path.attr("fill", "none");
    path.attr("stroke", "url(#fl-tealGradient)");
    path.attr("stroke-width", "1");
    path.attr("stroke-dasharray", "6 6");
    path.attr("stroke-linecap", "round");
    path.attr("opacity", "1");
    group.append(path);
  });

  svgEl.append(group);
}

function ensureDottedOutlineLogos(
  $: CheerioAPI,
  svgEl: Cheerio<NodeHandle>,
  meta: Phase1Meta,
) {
  const cx = meta.center.x;
  const cy = meta.center.y;
  const greyR =
    Number.parseFloat(svgEl.attr("data-radar-grey-r") ?? "") ||
    meta.frameRadius * 1.45;
  const R = greyR + 40;

  svgEl.find("#radar-dotted-logos").remove();
  const group = $('<g id="radar-dotted-logos" pointer-events="none"></g>');

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const specs = [
    { angle: 45, rotation: -45 },
    { angle: 135, rotation: 45 },
    { angle: 225, rotation: -45 },
    { angle: 315, rotation: 45 },
  ];

  specs.forEach((spec) => {
    const theta = toRad(spec.angle);
    const x = cx + R * Math.cos(theta);
    const y = cy + R * Math.sin(theta);
    const image = $("<image></image>");
    image.attr("x", String(x - 14));
    image.attr("y", String(y - 14));
    image.attr("width", "28");
    image.attr("height", "28");
    image.attr("href", "/logo fl fav.svg");
    image.attr("xlink:href", "/logo fl fav.svg");
    image.attr("preserveAspectRatio", "xMidYMid meet");
    image.attr("transform", `rotate(${spec.rotation} ${x} ${y})`);
    group.append(image);
  });

  svgEl.append(group);
}

function normalizeAngle(theta: number): number {
  let value = theta;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

function getConnectorQuadrantInfo(theta: number) {
  const angle = normalizeAngle(theta);
  const eps = Math.PI / 180;

  if (angle >= -Math.PI / 4 && angle < Math.PI / 4) {
    return { id: 0, laneTheta: angle, min: -Math.PI / 4 + eps, max: Math.PI / 4 - eps };
  }
  if (angle >= Math.PI / 4 && angle < (3 * Math.PI) / 4) {
    return { id: 1, laneTheta: angle, min: Math.PI / 4 + eps, max: (3 * Math.PI) / 4 - eps };
  }
  if (angle >= (-3 * Math.PI) / 4 && angle < -Math.PI / 4) {
    return { id: 3, laneTheta: angle, min: (-3 * Math.PI) / 4 + eps, max: -Math.PI / 4 - eps };
  }

  const laneTheta = angle < (-3 * Math.PI) / 4 ? angle + Math.PI * 2 : angle;
  return { id: 2, laneTheta, min: (3 * Math.PI) / 4 + eps, max: (5 * Math.PI) / 4 - eps };
}

function applyOuterLabelPosition(
  label: Cheerio<NodeHandle>,
  theta: number,
  cx: number,
  cy: number,
  startRadius: number,
) {
  const normalizedTheta = normalizeAngle(theta);
  const x = cx + startRadius * Math.cos(normalizedTheta);
  const y = cy + startRadius * Math.sin(normalizedTheta);
  const rotationDeg = (normalizedTheta * 180) / Math.PI;
  let finalRotation = rotationDeg;
  let anchor: "start" | "end" = "start";
  const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
  if (normalizedRotation > 90 && normalizedRotation < 270) {
    finalRotation = rotationDeg + 180;
    anchor = "end";
  }

  label.attr("x", String(x));
  label.attr("y", String(y));
  label.attr("text-anchor", anchor);
  label.attr("transform", `rotate(${finalRotation} ${x} ${y})`);
}


function appendOuterGreyRingLabels(
  $: CheerioAPI,
  svg: Cheerio<NodeHandle>,
  meta: Phase1Meta,
  normalizedBubbles: NormalizedBubble[],
) {
  const cx = meta.center.x;
  const cy = meta.center.y;
  const R_tealOuter =
  Number.parseFloat(svg.attr("data-radar-teal-r3") ?? "") ||
  Number.parseFloat(svg.attr("data-radar-teal-r2") ?? "") ||
  Number.parseFloat(svg.attr("data-radar-teal-r1") ?? "") ||
  meta.frameRadius * (3 / 4); // fallback to your 3rd teal ring radius
  const R_greyOuter = Number.parseFloat(svg.attr("data-radar-grey-r") ?? "") || meta.frameRadius * 1.45;
  const BAND_INNER = R_tealOuter + 12;
  const BAND_OUTER = R_greyOuter;
  const BAND_PADDING = 18;
  const R_start = BAND_INNER + BAND_PADDING;
const START_INSET = 2;

let R_start_safe = R_start + START_INSET;
R_start_safe = Math.max(R_start_safe, R_tealOuter + 12 + BAND_PADDING);
R_start_safe = Math.min(R_start_safe, BAND_OUTER - BAND_PADDING - 4);

const maxRadial = Math.max(0, (BAND_OUTER - BAND_PADDING) - (R_tealOuter + 8));


  let R_label = (BAND_INNER + BAND_OUTER) / 2;
  R_label = Math.min(BAND_OUTER - BAND_PADDING, Math.max(BAND_INNER + BAND_PADDING, R_label));
  

  

  // --- NEW: remove inner bubble labels from some HTML exports (Zukunft der Arbeit, Fachkräftemangel)
  svg.find("text.trend-label").toArray().forEach((node) => {
    const t = $(node);

    // Try x/y first (these problematic files use x/y, not rotate transforms)
    let tx = toNum(t.attr("x"));
    let ty = toNum(t.attr("y"));

    // Fallback: handle transform="translate(x y)" if ever present
    if ((tx == null || ty == null) && typeof t.attr("transform") === "string") {
      const m = String(t.attr("transform")).match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
      if (m) {
        tx = toNum(m[1]);
        ty = toNum(m[2]);
      }
    }

    if (tx == null || ty == null) return;

    const dist = Math.hypot(tx - cx, ty - cy);

    // Remove only labels that are well inside the outer label ring radius
    // (Outer ring labels should be at ~R_start_safe; bubble labels are much closer in)
    if (dist < R_start_safe - 14) {
      t.remove();
    }
  });
  // --- END NEW

  // ── Tunable constant: approximate px width per character at 10px font ──
  const CHAR_WIDTH_PX = 7;
  const MAX_DRIFT = Math.PI / 2; // ±90° clamp from original bubble angle
  const LABEL_OFFSET = 8; // px gap between outermost teal circle and label text

  // ── Collect bubbles and compute initial angles ──
  const domBubbles = svg.find("circle.bubble:not(.bubble-hit), circle.trend-bubble:not(.bubble-hit), circle[data-trend]:not(.bubble-hit)");
  const items = (domBubbles.length > 0
    ? domBubbles.toArray().map((node) => {
        const bubble = $(node);
        const nextText = bubble.next();
        const isBubbleLabel = nextText.length > 0 && nextText.is("text") && nextText.find("tspan").length > 0;
        const siblingLabel = isBubbleLabel ? (nextText.text() ?? "").replace(/\s+/g, " ").trim() : "";

        const tagName = ((node as { name?: string }).name ?? "").toLowerCase();
        const bx =
          tagName === "image"
            ? (toNum(bubble.attr("x")) ?? 0) + (toNum(bubble.attr("width")) ?? 0) / 2
            : toNum(bubble.attr("cx"));
        const by =
          tagName === "image"
            ? (toNum(bubble.attr("y")) ?? 0) + (toNum(bubble.attr("height")) ?? 0) / 2
            : toNum(bubble.attr("cy"));
        const label = (bubble.attr("data-trend") ?? siblingLabel).replace(/\s+/g, " ").trim();
        const clusterId = (bubble.attr("data-cluster-id") ?? bubble.attr("data-cluster") ?? "").trim();
        const trendKey = (bubble.attr("data-trend") ?? label).replace(/\s+/g, " ").trim();

        if (bx == null || by == null || !label) return null;

        const thetaRaw = Math.atan2(by - cy, bx - cx);
        return { label, theta: thetaRaw, origTheta: thetaRaw, clusterId, trendKey, halfWidth: 0 };
      })
    : normalizedBubbles.map((bubble) => {
        const label = (bubble.label ?? "").replace(/\s+/g, " ").trim();
        if (!label) return null;
        const thetaRaw = Math.atan2(bubble.cy - cy, bubble.cx - cx);
        return {
          label,
          theta: thetaRaw,
          origTheta: thetaRaw,
          clusterId: (bubble.clusterId ?? "").trim(),
          trendKey: (bubble.label ?? "").replace(/\s+/g, " ").trim(),
          halfWidth: 0,
        };
      }))
    .filter(
      (item): item is {
        label: string;
        theta: number;
        origTheta: number;
        clusterId: string;
        trendKey: string;
        halfWidth: number;
      } => Boolean(item),
    );

  if (items.length === 0) return;

  // ── Estimate angular half-width for each label ──
  // Labels are rotated as spokes (radially outward), so their angular footprint
  // is determined by the FONT HEIGHT (not text length). Text length extends
  // radially, not along the circumference.
  const labelRadius = R_tealOuter + LABEL_OFFSET;
  const FONT_HEIGHT_PX = 14; // 10px font + line spacing
  const baseAngularHalfWidth = (FONT_HEIGHT_PX / labelRadius) / 2;
  // Dynamic minimum gap: scales down when there are many labels so they can all fit
  const MIN_ANGULAR_GAP = Math.max(
    3 * (Math.PI / 180),                         // at least 3°
    (Math.PI * 2 / items.length) * 0.6,          // 60% of even spacing
  );
  items.forEach((item) => {
    item.halfWidth = Math.max(baseAngularHalfWidth, MIN_ANGULAR_GAP / 2);
  });

  // ── Convert to [0, 2π) and sort by angle ──
  items.forEach((item) => {
    item.theta = item.theta < 0 ? item.theta + Math.PI * 2 : item.theta;
    item.origTheta = item.theta; // store in [0, 2π) form
  });
  items.sort((a, b) => a.theta - b.theta);

  // ── Iterative push-apart relaxation ──
  const TWO_PI = Math.PI * 2;

  const pushApart = (maxPasses: number) => {
    for (let pass = 0; pass < maxPasses; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const j = (i + 1) % items.length;
        const a = items[i];
        const b = items[j];

        let gap = b.theta - a.theta;
        if (j === 0) gap += TWO_PI; // wrap-around from last to first

        const needed = a.halfWidth + b.halfWidth;
        if (gap < needed) {
          const overlap = needed - gap;
          a.theta -= overlap / 2;
          b.theta += overlap / 2;
          moved = true;
        }
      }
      // Re-normalize to [0, 2π) after each pass
      items.forEach((item) => {
        item.theta = ((item.theta % TWO_PI) + TWO_PI) % TWO_PI;
      });
      // Re-sort since items may have crossed
      items.sort((a, b) => a.theta - b.theta);
      if (!moved) break;
    }
  };

  pushApart(50);

  // ── Clamp: each label must stay within ±90° of its original bubble angle ──
  items.forEach((item) => {
    let delta = item.theta - item.origTheta;
    // Wrap delta to [-π, π]
    if (delta > Math.PI) delta -= TWO_PI;
    if (delta < -Math.PI) delta += TWO_PI;

    if (Math.abs(delta) > MAX_DRIFT) {
      item.theta = item.origTheta + Math.sign(delta) * MAX_DRIFT;
      item.theta = ((item.theta % TWO_PI) + TWO_PI) % TWO_PI;
    }
  });

  // Second push-apart pass to fix overlaps re-introduced by clamping
  items.sort((a, b) => a.theta - b.theta);
  pushApart(20);

  // ── Convert back to [-π, π] for rendering ──
  items.forEach((item) => {
    if (item.theta > Math.PI) item.theta -= TWO_PI;
    item.theta = normalizeAngle(item.theta);
  });

  // ── Create SVG text elements ──
  const group = $('<g id="radar-labels-outer"></g>');
  items.forEach((item) => {
    const theta = item.theta;
    const x = cx + labelRadius * Math.cos(theta);
    const y = cy + labelRadius * Math.sin(theta);
    const rotationDeg = (theta * 180) / Math.PI;
    let finalRotation = rotationDeg;
    let anchor: "start" | "end" = "start";
    const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
    if (normalizedRotation > 90 && normalizedRotation < 270) {
      finalRotation = rotationDeg + 180;
      anchor = "end";
    }

    const text = $("<text></text>");
    text.attr("x", String(x));
    text.attr("y", String(y));
    text.attr("text-anchor", anchor);
    text.attr("dominant-baseline", "middle");
    text.attr("font-family", "Open Sans, sans-serif");
    text.attr("font-size", "10");
    text.attr("transform", `rotate(${finalRotation} ${x} ${y})`);
    if (item.clusterId) {
      text.attr("data-cluster-id", item.clusterId);
    }
    text.attr("data-trend", item.trendKey);
    text.attr("data-label-theta", String(theta));
    const estimatedRadialLength = item.label.length * CHAR_WIDTH_PX;
    if (estimatedRadialLength > maxRadial) {
      text.attr("textLength", String(maxRadial));
      text.attr("lengthAdjust", "spacingAndGlyphs");
    }
    text.text(item.label);
    group.append(text);
  });

  svg.append(group);
}

function removeOriginalBubbleLabels(
  $: CheerioAPI,
  svg: Cheerio<NodeHandle>,
  meta: Phase1Meta,
  normalizedBubbles: NormalizedBubble[],
) {
  const R_tealOuter =
    Number.parseFloat(svg.attr("data-radar-teal-r3") ?? "") ||
    Number.parseFloat(svg.attr("data-radar-teal-r2") ?? "") ||
    Number.parseFloat(svg.attr("data-radar-teal-r1") ?? "") ||
    meta.frameRadius;

  const textNodes = svg.find("text").toArray();
  textNodes.forEach((node) => {
    const text = $(node);
    if (text.closest("#radar-labels-outer").length) return;

    const x = toSvgCoord(text.attr("x"));
    const y = toSvgCoord(text.attr("y"));
    if (x == null || y == null) return;

    const textAnchor = (text.attr("text-anchor") ?? "").trim().toLowerCase();
    const fontSizeRaw = text.attr("font-size") ?? "";
    const fontSize = Number.parseFloat(fontSizeRaw);
    const isMiddle = textAnchor === "middle";
    const isSmall = Number.isFinite(fontSize) && fontSize <= 14;
    if (!isMiddle && !isSmall) return;

    const insideTeal = Math.hypot(x - meta.center.x, y - meta.center.y) <= R_tealOuter + 4;
    if (!insideTeal) return;

    const nearBubble = normalizedBubbles.some(
      (bubble) => Math.abs(x - bubble.cx) <= 2 && Math.abs(y - bubble.cy) <= 25,
    );
    if (nearBubble) {
      text.remove();
    }
  });

  svg.find("circle.bubble, circle.trend-bubble, circle[class*=\"bubble\"], image.bubble")
    .toArray()
    .forEach((node) => {
      const bubble = $(node);
      const next = bubble.next();
      if (next.length && next.is("text") && !next.closest("#radar-labels-outer").length) {
        next.remove();
      }
    });
}

function drawStraightBubbleLabelConnectors(
  $: CheerioAPI,
  svg: Cheerio<NodeHandle>,
  meta: Phase1Meta,
  normalizedBubbles: NormalizedBubble[],
) {
  svg.children("#radar-connectors").remove();

  const labelsGroup = svg.find("#radar-labels-outer").first();
  if (!labelsGroup.length) return;

  const connectorGroup = $('<g id="radar-connectors" pointer-events="none"></g>');
  const firstBubbleNode = svg.find("circle.bubble, image.bubble").first();
  if (firstBubbleNode.length) {
    firstBubbleNode.before(connectorGroup);
  } else {
    svg.append(connectorGroup);
  }

  const cxRadar = meta.center.x;
  const cyRadar = meta.center.y;
  const R_tealOuter =
    Number.parseFloat(svg.attr("data-radar-teal-r3") ?? "") ||
    Number.parseFloat(svg.attr("data-radar-teal-r2") ?? "") ||
    Number.parseFloat(svg.attr("data-radar-teal-r1") ?? "") ||
    meta.frameRadius * (3 / 4);
  const R_greyOuter = Number.parseFloat(svg.attr("data-radar-grey-r") ?? "") || meta.frameRadius * 1.45;
  const BAND_INNER = R_tealOuter + 12;
  const BAND_OUTER = R_greyOuter;
  const BAND_PADDING = 18;
  const R_start = BAND_INNER + BAND_PADDING;
  const START_INSET = 2;
  let R_start_safe = R_start + START_INSET;
  R_start_safe = Math.max(R_start_safe, R_tealOuter + 12 + BAND_PADDING);
  R_start_safe = Math.min(R_start_safe, BAND_OUTER - BAND_PADDING - 4);

  const clusterIdToLabel = new Map<string, Cheerio<NodeHandle>>();
  const trendToLabel = new Map<string, Cheerio<NodeHandle>>();
  const getConnectorStrokeForBubble = (bubble: Cheerio<NodeHandle>) => {
    const resolvedType = resolveBubbleTypeFromNode(bubble);
    if (resolvedType) return getConnectorStrokeFromType(resolvedType);
    return "#999";
  };

  labelsGroup.find("text").toArray().forEach((node) => {
    const label = $(node);
    const clusterId = (label.attr("data-cluster-id") ?? "").trim();
    const trend = (label.attr("data-trend") ?? "").trim();

    if (clusterId && !clusterIdToLabel.has(clusterId)) {
      clusterIdToLabel.set(clusterId, label);
    }
    if (trend && !trendToLabel.has(trend)) {
      trendToLabel.set(trend, label);
    }
  });

  const domHitCircles = svg.find("circle.bubble, circle.trend-bubble, circle[data-trend]").toArray();
  const connectorItems = (domHitCircles.length > 0
    ? domHitCircles.map((node) => {
        const bubble = $(node);
        const bx = Number.parseFloat(bubble.attr("cx") ?? "");
        const by = Number.parseFloat(bubble.attr("cy") ?? "");
        if (!Number.isFinite(bx) || !Number.isFinite(by)) return null;

        const clusterId = (bubble.attr("data-cluster-id") ?? bubble.attr("data-cluster") ?? "").trim();
        const trend = (bubble.attr("data-trend") ?? "").trim();
        const label = clusterId ? clusterIdToLabel.get(clusterId) : trend ? trendToLabel.get(trend) : undefined;
        if (!label || !label.length) return null;

        const lx = Number.parseFloat(label.attr("x") ?? "");
        const ly = Number.parseFloat(label.attr("y") ?? "");
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;

        const theta = Math.atan2(ly - cyRadar, lx - cxRadar);
        const quadrant = getConnectorQuadrantInfo(theta);

        return {
          bx,
          by,
          lx,
          ly,
          theta,
          laneTheta: quadrant.laneTheta,
          quadrantId: quadrant.id,
          anchor: (label.attr("text-anchor") ?? "").trim(),
          stroke: getConnectorStrokeForBubble(bubble),
        };
      })
    : normalizedBubbles.map((bubble) => {
        const clusterId = (bubble.clusterId ?? "").trim();
        const trend = (bubble.label ?? "").replace(/\s+/g, " ").trim();
        const label = clusterId ? clusterIdToLabel.get(clusterId) : trend ? trendToLabel.get(trend) : undefined;
        if (!label || !label.length) return null;

        const lx = Number.parseFloat(label.attr("x") ?? "");
        const ly = Number.parseFloat(label.attr("y") ?? "");
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;

        const theta = Math.atan2(ly - cyRadar, lx - cxRadar);
        const quadrant = getConnectorQuadrantInfo(theta);
        const fallbackStroke =
          (() => {
            const normalizedBucket = normalizeBucket(bubble.bucket);
            if (normalizedBucket) {
              return getConnectorStrokeFromType(bucketBubbleTypeMap[normalizedBucket]);
            }
            const typeFromFill = getBubbleTypeFromFill(bubble.fillRaw ?? undefined);
            return typeFromFill ? getConnectorStrokeFromType(typeFromFill) : "#999";
          })();

        return {
          bx: bubble.cx,
          by: bubble.cy,
          lx,
          ly,
          theta,
          laneTheta: quadrant.laneTheta,
          quadrantId: quadrant.id,
          anchor: (label.attr("text-anchor") ?? "").trim(),
          stroke: fallbackStroke,
        };
      }))
    .filter(
      (item): item is {
        bx: number;
        by: number;
        lx: number;
        ly: number;
        theta: number;
        laneTheta: number;
        quadrantId: number;
        anchor: string;
        stroke: string;
      } => Boolean(item),
    );

  const quadrantConnectors = new Map<number, typeof connectorItems>();
  connectorItems.forEach((item) => {
    const group = quadrantConnectors.get(item.quadrantId) ?? [];
    group.push(item);
    quadrantConnectors.set(item.quadrantId, group);
  });

  quadrantConnectors.forEach((items) => {
    items.sort((left, right) => left.laneTheta - right.laneTheta);
    const laneStep = items.length > 18 ? 4 : 6;

    items.forEach((item, index) => {
      const offset = (index - (items.length - 1) / 2) * laneStep;
      const thetaLabel = Math.atan2(item.ly - cyRadar, item.lx - cxRadar);
      const vx = Math.cos(thetaLabel);
      const vy = Math.sin(thetaLabel);
      const tx = -vy;
      const ty = vx;

      // Connector endpoint: intersection with outermost teal circle
      const p3x = cxRadar + R_tealOuter * vx;
      const p3y = cyRadar + R_tealOuter * vy;

      const distance = Math.hypot(p3x - item.bx, p3y - item.by);
      const c1 = Math.max(30, Math.min(160, distance * 0.22));
      const c2 = Math.max(40, Math.min(190, distance * 0.32));
      const p1x = item.bx + vx * c1 + tx * offset;
      const p1y = item.by + vy * c1 + ty * offset;
      const p2x = p3x - vx * c2 + tx * (offset * 0.35);
      const p2y = p3y - vy * c2 + ty * (offset * 0.35);

      const path = $("<path></path>");
      path.attr("d", `M ${item.bx} ${item.by} C ${p1x} ${p1y} ${p2x} ${p2y} ${p3x} ${p3y}`);
      path.attr("stroke", item.stroke);
      path.attr("stroke-width", "0.55");
      path.attr("fill", "none");
      path.attr("stroke-linecap", "round");
      path.attr("stroke-linejoin", "round");
      path.attr("opacity", "0.9");
      connectorGroup.append(path);
    });
  });
}

function normalizeRadarLayerOrder($: CheerioAPI, svg: Cheerio<NodeHandle>) {
  let ringsGroup = svg.children("#radar-rings").first();
  const injectedRingsGroup = svg.children('g[data-radar-rings="true"]').first();
  if (!ringsGroup.length && injectedRingsGroup.length) {
    ringsGroup = injectedRingsGroup;
    ringsGroup.attr("id", "radar-rings");
  }
  if (!ringsGroup.length) {
    ringsGroup = $('<g id="radar-rings"></g>') as Cheerio<NodeHandle>;
  }

  let connectorsGroup = svg.children("#radar-connectors").first();
  if (!connectorsGroup.length) {
    connectorsGroup = $('<g id="radar-connectors" pointer-events="none"></g>') as Cheerio<NodeHandle>;
  }

  let bubblesGroup = svg.children("#radar-bubbles").first();
  if (!bubblesGroup.length) {
    bubblesGroup = $('<g id="radar-bubbles"></g>') as Cheerio<NodeHandle>;
  }

  let labelsGroup = svg.children("#radar-labels-outer").first();
  if (!labelsGroup.length) {
    labelsGroup = $('<g id="radar-labels-outer"></g>') as Cheerio<NodeHandle>;
  }
  let pwlgGroup = svg.children("#radar-pwlg").first();
  if (!pwlgGroup.length) {
    pwlgGroup = $('<g id="radar-pwlg"></g>') as Cheerio<NodeHandle>;
  }
  let dottedOutlineGroup = svg.children("#radar-dotted-outline").first();
  if (!dottedOutlineGroup.length) {
    dottedOutlineGroup = $('<g id="radar-dotted-outline" pointer-events="none"></g>') as Cheerio<NodeHandle>;
  }
  let dottedLogosGroup = svg.children("#radar-dotted-logos").first();
  if (!dottedLogosGroup.length) {
    dottedLogosGroup = $('<g id="radar-dotted-logos" pointer-events="none"></g>') as Cheerio<NodeHandle>;
  }

  const layerIds = new Set([
    "radar-rings",
    "radar-connectors",
    "radar-bubbles",
    "radar-labels-outer",
    "radar-pwlg",
    "radar-dotted-outline",
    "radar-dotted-logos",
  ]);
  svg.children().toArray().forEach((node) => {
    const child = $(node);
    const id = (child.attr("id") ?? "").trim();
    if (layerIds.has(id)) return;
    if (child.is("defs") || child.is("style") || child.is("script")) return;
    child.remove();
    ringsGroup.append(child);
  });

  svg.find("circle.bubble, circle.trend-bubble, circle[data-trend], image.bubble, image.trend-bubble, image[data-trend]").toArray().forEach((node) => {
    const bubble = $(node);
    if (bubble.closest("#radar-bubbles").length) return;
    bubble.remove();
    bubblesGroup.append(bubble);
  });

  ringsGroup.remove();
  connectorsGroup.remove();
  bubblesGroup.remove();
  labelsGroup.remove();
  pwlgGroup.remove();
  dottedOutlineGroup.remove();
  dottedLogosGroup.remove();

  svg.append(ringsGroup);
  svg.append(connectorsGroup);
  svg.append(bubblesGroup);
  svg.append(labelsGroup);
  svg.append(pwlgGroup);
  svg.append(dottedOutlineGroup);
  svg.append(dottedLogosGroup);
}

function getBubbleAssetPath(bucket: string | undefined): string | null {
  const normalizedBucket = normalizeBucket(bucket);
  if (!normalizedBucket) return null;
  return getBubbleAssetPathFromType(bucketBubbleTypeMap[normalizedBucket]);
}

function getBubbleAssetPathFromFill(fillRaw: string | undefined): string | null {
  const type = getBubbleTypeFromFill(fillRaw);
  return type ? getBubbleAssetPathFromType(type) : null;
}

function getBubbleTypeFromFill(fillRaw: string | undefined): BubbleType | null {
  const fill = normHex(fillRaw);
  if (fill === "#0000ff") return "Sehr hoch";
  if (fill === "#00aa00") return "Hoch";
  if (fill === "#ffff00") return "Niedrig";
  if (fill === "#ff0000") return "Sehr niedrig";
  return null;
}

function normalizeBucket(raw: string | null | undefined): BucketKey | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "1" || value === "2" || value === "3" || value === "4") {
    return value;
  }
  const direct = value.match(/^bucket\s*([1-4])$/i);
  if (direct) return direct[1] as BucketKey;
  return null;
}

function getBucketFromClass(classAttr: string | null | undefined): BucketKey | null {
  const classValue = String(classAttr ?? "").trim();
  if (!classValue) return null;

  const tokens = classValue.split(/\s+/);
  for (const token of tokens) {
    const normalized = normalizeBucket(token);
    if (normalized) return normalized;
  }

  const compactMatch = classValue.match(/\bbucket([1-4])\b/i);
  if (compactMatch) return compactMatch[1] as BucketKey;

  const spacedMatch = classValue.match(/\bbucket\s+([1-4])\b/i);
  if (spacedMatch) return spacedMatch[1] as BucketKey;

  return null;
}

function getBucketFromNode(bubble: Cheerio<NodeHandle>): BucketKey | null {
  const fromData = normalizeBucket(bubble.attr("data-bucket"));
  if (fromData) return fromData;
  return getBucketFromClass(bubble.attr("class"));
}

function resolveBubbleTypeFromNode(bubble: Cheerio<NodeHandle>): BubbleType | null {
  const bucket = getBucketFromNode(bubble);
  if (bucket) return bucketBubbleTypeMap[bucket];
  return getBubbleTypeFromFill(bubble.attr("fill"));
}

function getBubbleAssetPathFromType(type: BubbleType): string {
  return bubbleTypeAssetMap[type];
}

function getConnectorStrokeFromType(type: BubbleType): string {
  return bubbleTypeConnectorStrokeMap[type];
}

function getBubbleTypeFromNode(bubble: Cheerio<NodeHandle>): BubbleType | null {
  return resolveBubbleTypeFromNode(bubble);
}

function collectBubbleOutput($: CheerioAPI, svgEl: Cheerio<NodeHandle>) {
  return svgEl.find("image.bubble, circle.bubble").toArray().map((node, index) => {
    const bubble = $(node);
    const resolvedType = getBubbleTypeFromNode(bubble) ?? "Hoch";

    return {
      id: bubble.attr("data-cluster-id") ?? bubble.attr("data-trend") ?? `bubble-${index + 1}`,
      label: (bubble.attr("data-trend") ?? "").replace(/\s+/g, " ").trim(),
      type: resolvedType,
    };
  });
}

function replaceBubbleCirclesWithImages(
  $: CheerioAPI,
  svgEl: Cheerio<NodeHandle>,
  warnings: string[],
  normalizedBubbles: NormalizedBubble[],
) {
  const SCALE_BIG = 1.78;
  const SCALE_MED = 1.48;
  const SCALE_TIGHT = 1.34;
  const HIT_SCALE = 2.03; // SCALE_BIG (1.78) + 0.25 — must clear the largest image overlay
  const bubbleNodes = normalizedBubbles.map((nb) => {
    const bubble = nb.node;
    return {
      node: bubble,
      cx: nb.cx,
      cy: nb.cy,
      rBase: nb.r,
      bucket: nb.bucket,
      fillRaw: nb.fillRaw,
      resolvedType: nb.resolvedType,
    };
  });

  bubbleNodes.forEach(({ node, cx, cy, rBase, bucket, fillRaw, resolvedType }) => {
    const bubble = node;
    if (bubble.hasClass("bubble-hit")) return;

    const type = resolvedType ?? getBubbleTypeFromFill(fillRaw ?? bubble.attr("fill") ?? undefined);
    const assetPath = type ? getBubbleAssetPathFromType(type) : null;

    if (!assetPath) {
      warnings.push(
        `Bubble has unknown fill (${fillRaw ?? "none"}) and bucket (${bucket ?? "missing"}).`,
      );
      return;
    }

    if (cx == null || cy == null || rBase == null) {
      warnings.push("Bubble has invalid cx/cy/r and was left unchanged.");
      return;
    }
    let minDist = Number.POSITIVE_INFINITY;
    let safeDistance = Number.POSITIVE_INFINITY;
    bubbleNodes.forEach((other) => {
      if (other.node === node || other.cx == null || other.cy == null || other.rBase == null) return;
      const dist = Math.hypot(cx - other.cx, cy - other.cy);
      if (dist < minDist) {
        minDist = dist;
        safeDistance = (rBase + other.rBase) * 1.95;
      }
    });

    const VISUAL_SCALE =
  minDist < safeDistance
    ? SCALE_TIGHT
    : minDist < safeDistance * 1.12
    ? SCALE_MED
    : SCALE_BIG;
    const diameter = rBase * 2;

    const image = $("<image></image>");
    image.attr("x", String(cx - rBase));
    image.attr("y", String(cy - rBase));
    image.attr("width", String(diameter));
    image.attr("height", String(diameter));
    image.attr("href", assetPath);
    image.attr("xlink:href", assetPath);
    if (type) image.attr("data-bubble-type", type);
    image.attr("preserveAspectRatio", "xMidYMid meet");
    image.attr(
  "transform",
  `translate(${cx} ${cy}) scale(${VISUAL_SCALE}) translate(${-cx} ${-cy})`
);
    image.attr("pointer-events", "none");

    Object.entries((bubble.get(0) as { attribs?: Record<string, string> }).attribs ?? {}).forEach(([name, value]) => {
      if (name === "class" || name.startsWith("data-")) {
        image.attr(name, value);
      }
    });
    if (!/\bbubble\b/.test(image.attr("class") ?? "")) {
      image.attr("class", `${image.attr("class") ?? ""} bubble`.trim());
    }

    const hit = $("<circle></circle>");
hit.attr("cx", String(cx));
hit.attr("cy", String(cy));
hit.attr("r", String(rBase * HIT_SCALE));
hit.attr("fill", "transparent");
hit.attr("pointer-events", "all");

// copy the same class + data-* so your existing selection logic still works
Object.entries((bubble.get(0) as { attribs?: Record<string, string> }).attribs ?? {}).forEach(([name, value]) => {
  if (name === "class" || name.startsWith("data-")) {
    hit.attr(name, value);
  }
});
if (!/\bbubble\b/.test(hit.attr("class") ?? "")) {
  hit.attr("class", `${hit.attr("class") ?? ""} bubble`.trim());
}

    bubble.replaceWith(hit);
    hit.after(image);
  });
}

function applyBubbleBreathingSpace(
  $: CheerioAPI,
  svgEl: Cheerio<NodeHandle>,
  meta: Phase1Meta
) {
  const cx = meta.center.x;
  const cy = meta.center.y;

  // Use the actual teal outer radius stored by your ensureBackgroundRings()
  const tealR3 =
    Number.parseFloat(svgEl.attr("data-radar-teal-r3") ?? "") || meta.frameRadius;

  const paddingPx = 18; // tweak: 12–28 usually feels right
  const desiredMax = tealR3 + paddingPx;

  const bubbles = svgEl.find('circle.bubble, circle[data-bucket], circle[data-radius-px]');
  if (!bubbles.length) return;

  // Find current max extent (distance + radius)
  let currentMax = 0;
  bubbles.each((_, node) => {
    const el = $(node);

    const bx = Number.parseFloat(el.attr("cx") ?? "");
    const by = Number.parseFloat(el.attr("cy") ?? "");
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;

    const r =
      Number.parseFloat(el.attr("r") ?? "") ||
      Number.parseFloat(el.attr("data-radius-px") ?? "") ||
      0;

    const d = Math.hypot(bx - cx, by - cy) + (Number.isFinite(r) ? r : 0);
    if (d > currentMax) currentMax = d;
  });

  if (currentMax <= 0) return;

  // Scale bubbles inward only if needed
  const rawScale = desiredMax / currentMax;
  const scale = Math.max(1, Math.min(1.18, rawScale)); // clamp: never grow; never crush too hard

  if (scale >= 0.999) return; // already has enough breathing space

  // Move bubbles + their immediate following <text> label(s)
  bubbles.each((_, node) => {
    const bubble = $(node);

    const bx = Number.parseFloat(bubble.attr("cx") ?? "");
    const by = Number.parseFloat(bubble.attr("cy") ?? "");
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;

    const nx = cx + (bx - cx) * scale;
    const ny = cy + (by - cy) * scale;

    bubble.attr("cx", String(nx));
    bubble.attr("cy", String(ny));

    // In your source HTML, the label is typically the next sibling <text> right after the circle :contentReference[oaicite:1]{index=1}
    const maybeText = bubble.nextAll("text").first();
    if (maybeText.length) {
      const tx = Number.parseFloat(maybeText.attr("x") ?? "");
      const ty = Number.parseFloat(maybeText.attr("y") ?? "");
      if (Number.isFinite(tx)) maybeText.attr("x", String(cx + (tx - cx) * scale));
      if (Number.isFinite(ty)) maybeText.attr("y", String(cy + (ty - cy) * scale));

      // Keep tspans aligned (your source uses tspans with explicit x) :contentReference[oaicite:2]{index=2}
      maybeText.find("tspan").each((_, tspanNode) => {
        const ts = $(tspanNode);
        const tsx = Number.parseFloat(ts.attr("x") ?? "");
        if (Number.isFinite(tsx)) ts.attr("x", String(cx + (tsx - cx) * scale));
      });
    }
  });

  // Optional: annotate for debugging
  svgEl.attr("data-radar-bubble-scale", String(scale));
  svgEl.attr("data-radar-bubble-padding", String(paddingPx));
}

function phase1Detect($: CheerioAPI, svg: Cheerio<NodeHandle>): Phase1Meta {
  const ringCandidates = collectRingCandidates($, svg);
  const ringCount =
    ringCandidates.circles.length +
    ringCandidates.ellipses.length +
    ringCandidates.paths.length;

  const axes = collectAxisLineCandidates($, svg);
  const axisCount = axes.length;

  const centerFromRings = computeCenterFromRings($, ringCandidates);
  const centerFromAxes = computeCenterFromAxes(svg, axes);
  const center = centerFromRings ?? centerFromAxes ?? viewBoxCenter(svg);

  const centerFrom: Phase1Meta["source"]["centerFrom"] =
    centerFromRings ? "rings" : centerFromAxes ? "axisIntersection" : "viewBox";

  const outerRingR = computeOuterRingRadius($, ringCandidates, center);
  const frameRadius = outerRingR ?? approxViewBoxRadius(svg);

  const radiusFrom: Phase1Meta["source"]["radiusFrom"] =
    outerRingR ? "outerRing" : "viewBox";

  return {
    center,
    frameRadius,
    ringCount,
    axisCount,
    source: { centerFrom, radiusFrom },
  };
}

export function transformTrendRadarHtmlToStyledSvg(
  inputHtml: string,
  _options?: Partial<TransformOptions>,
): TransformResult {
  if (!RADAR_TRANSFORM_ENABLED) {
    return { svg: inputHtml, bubbles: [], warnings: [] };
  }

  const warnings: string[] = [];
  const $ = cheerio.load(inputHtml, { xmlMode: true });

  const svgEl = $("svg").first();
  if (!svgEl.length) {
    return { svg: inputHtml, bubbles: [], warnings: ["No <svg> found in uploaded HTML."] };
  }
  const normalizedBubbles = collectNormalizedBubbles($, svgEl as Cheerio<CheerioElement>, warnings);

  // ── Normalize to 1000×1000 output coordinate space ──
  const OUTPUT_SIZE = 1000;
  const OUTPUT_CENTER = OUTPUT_SIZE / 2; // 500
  const FIXED_FRAME_RADIUS = 400; // outermost teal circle radius in output space

  // Detect input dimensions
  const vb = getViewBox(svgEl);
  const inputW = vb?.width ?? toNum(svgEl.attr("width")) ?? OUTPUT_SIZE;
  const inputH = vb?.height ?? toNum(svgEl.attr("height")) ?? OUTPUT_SIZE;
  const inputCx = (vb?.minX ?? 0) + inputW / 2;
  const inputCy = (vb?.minY ?? 0) + inputH / 2;
  const inputRadius = Math.min(inputW, inputH) / 2;
  const bubbleScale = FIXED_FRAME_RADIUS / inputRadius;

  // Detect whether this is a plus-axis input (horizontal + vertical lines through centre).
  // Must be checked BEFORE line scaling so we read original input coordinates.
  // Pflege2030 is a typical plus-axis radar: H line at y≈inputCy, V line at x≈inputCx.
  const AXIS_INPUT_THRESHOLD = Math.max(12, inputRadius * 0.03);
  const isPlusAxisInput = (() => {
    const lineNodes = svgEl.find("line").toArray();
    const hasH = lineNodes.some((node) => {
      const el = $(node);
      const y1 = Number.parseFloat(el.attr("y1") ?? "");
      const y2 = Number.parseFloat(el.attr("y2") ?? "");
      return Math.abs(y1 - inputCy) < AXIS_INPUT_THRESHOLD && Math.abs(y2 - inputCy) < AXIS_INPUT_THRESHOLD;
    });
    const hasV = lineNodes.some((node) => {
      const el = $(node);
      const x1 = Number.parseFloat(el.attr("x1") ?? "");
      const x2 = Number.parseFloat(el.attr("x2") ?? "");
      return Math.abs(x1 - inputCx) < AXIS_INPUT_THRESHOLD && Math.abs(x2 - inputCx) < AXIS_INPUT_THRESHOLD;
    });
    return hasH && hasV;
  })();

  // Scale all bubble DOM nodes to output coordinate space
  svgEl.find("circle[data-trend], circle.bubble, circle.trend-bubble, circle[data-bucket], circle[class*='bucket']")
    .not(".bubble-hit")
    .each((_, node) => {
      const el = $(node);
      const bx = Number.parseFloat(el.attr("cx") ?? "");
      const by = Number.parseFloat(el.attr("cy") ?? "");
      const br = Number.parseFloat(el.attr("r") ?? "");
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
      el.attr("cx", String(OUTPUT_CENTER + (bx - inputCx) * bubbleScale));
      el.attr("cy", String(OUTPUT_CENTER + (by - inputCy) * bubbleScale));
    });

  // Scale normalizedBubbles positions to match (r already normalized in collectNormalizedBubbles)
  normalizedBubbles.forEach((nb) => {
    nb.cx = OUTPUT_CENTER + (nb.cx - inputCx) * bubbleScale;
    nb.cy = OUTPUT_CENTER + (nb.cy - inputCy) * bubbleScale;
  });

  // If the input uses plus-shaped axes, rotate all bubble positions 45° CW in SVG space
  // (−45° in standard math) around OUTPUT_CENTER so that quadrant alignment matches the
  // diagonal-axis output: P(NW)→left, W(NE)→top, G(SW)→bottom, L(SE)→right.
  if (isPlusAxisInput) {
    const INV_SQRT2 = 1 / Math.SQRT2;
    svgEl.find("circle[data-trend], circle.bubble, circle.trend-bubble, circle[data-bucket], circle[class*='bucket']")
      .not(".bubble-hit")
      .each((_, node) => {
        const el = $(node);
        const bx = Number.parseFloat(el.attr("cx") ?? "");
        const by = Number.parseFloat(el.attr("cy") ?? "");
        if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
        const dx = bx - OUTPUT_CENTER;
        const dy = by - OUTPUT_CENTER;
        el.attr("cx", String(OUTPUT_CENTER + (dx + dy) * INV_SQRT2));
        el.attr("cy", String(OUTPUT_CENTER + (-dx + dy) * INV_SQRT2));
      });
    normalizedBubbles.forEach((nb) => {
      const dx = nb.cx - OUTPUT_CENTER;
      const dy = nb.cy - OUTPUT_CENTER;
      nb.cx = OUTPUT_CENTER + (dx + dy) * INV_SQRT2;
      nb.cy = OUTPUT_CENTER + (-dx + dy) * INV_SQRT2;
    });
  }

  // Scale axis lines
  svgEl.find("line").each((_, node) => {
    const el = $(node);
    const attrs = ["x1", "y1", "x2", "y2"] as const;
    const vals = attrs.map(a => Number.parseFloat(el.attr(a) ?? ""));
    if (!vals.every(Number.isFinite)) return;
    el.attr("x1", String(OUTPUT_CENTER + (vals[0] - inputCx) * bubbleScale));
    el.attr("y1", String(OUTPUT_CENTER + (vals[1] - inputCy) * bubbleScale));
    el.attr("x2", String(OUTPUT_CENTER + (vals[2] - inputCx) * bubbleScale));
    el.attr("y2", String(OUTPUT_CENTER + (vals[3] - inputCy) * bubbleScale));
  });

  // Scale original inner bubble labels so removeOriginalBubbleLabels can detect them
  svgEl.find("text.trend-label, text[text-anchor='middle']").each((_, node) => {
    const el = $(node);
    const tx = Number.parseFloat(el.attr("x") ?? "");
    const ty = Number.parseFloat(el.attr("y") ?? "");
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    el.attr("x", String(OUTPUT_CENTER + (tx - inputCx) * bubbleScale));
    el.attr("y", String(OUTPUT_CENTER + (ty - inputCy) * bubbleScale));
  });

  // Set SVG to fixed output size
  svgEl.attr("width", String(OUTPUT_SIZE));
  svgEl.attr("height", String(OUTPUT_SIZE));
  svgEl.attr("viewBox", `0 0 ${OUTPUT_SIZE} ${OUTPUT_SIZE}`);

  // Override meta to use fixed output coordinates
  const meta = phase1Detect($, svgEl);
  meta.center = { x: OUTPUT_CENTER, y: OUTPUT_CENTER };
  meta.frameRadius = FIXED_FRAME_RADIUS;

  annotateSvg(svgEl, meta);
  ensureBackgroundRings(svgEl, meta);
  removeOriginalBubbleLabels($, svgEl, meta, normalizedBubbles);

  // Extend diagonal axis lines to the grey circle radius and style them white
const cx = meta.center.x;
const cy = meta.center.y;

// Prefer the actual grey radius stored on the svg by ensureBackgroundRings
const greyR =
  Number.parseFloat(svgEl.attr("data-radar-grey-r") ?? "") ||
  meta.frameRadius * 1.12; // fallback (should match your ring function)

  // Convert plus-shaped (horizontal + vertical) axes to diagonal (X-shaped) axes.
  // Inputs like Pflege2030 use a H/V cross; the output radar expects ±45° diagonals.
  // Detection: a line is horizontal if both y-coords ≈ cy; vertical if both x-coords ≈ cx.
  // We need both to be present before converting, so a single stray line is left alone.
  {
    const AXIS_THRESHOLD = 12; // px tolerance in output-space (center is at OUTPUT_CENTER)
    const allLineNodes = svgEl.find("line").toArray();

    const hNode = allLineNodes.find((node) => {
      const el = $(node);
      const y1 = Number.parseFloat(el.attr("y1") ?? "");
      const y2 = Number.parseFloat(el.attr("y2") ?? "");
      return Math.abs(y1 - cy) < AXIS_THRESHOLD && Math.abs(y2 - cy) < AXIS_THRESHOLD;
    });
    const vNode = allLineNodes.find((node) => {
      const el = $(node);
      const x1 = Number.parseFloat(el.attr("x1") ?? "");
      const x2 = Number.parseFloat(el.attr("x2") ?? "");
      return Math.abs(x1 - cx) < AXIS_THRESHOLD && Math.abs(x2 - cx) < AXIS_THRESHOLD;
    });

    if (hNode && vNode) {
      // Use greyR as initial span — the extension loop below will normalize to exact boundary
      const d = greyR / Math.SQRT2;
      // Horizontal → 45° diagonal: top-left ↔ bottom-right
      $(hNode)
        .attr("x1", String(cx - d)).attr("y1", String(cy - d))
        .attr("x2", String(cx + d)).attr("y2", String(cy + d))
        .attr("stroke", "black").removeAttr("class");
      // Vertical → −45° diagonal: top-right ↔ bottom-left
      $(vNode)
        .attr("x1", String(cx + d)).attr("y1", String(cy - d))
        .attr("x2", String(cx - d)).attr("y2", String(cy + d))
        .attr("stroke", "black").removeAttr("class");
    }
  }

  // Expand viewBox so the grey circle (and axes) never get clipped
const padding = 40; // tweak 20–80 if needed
const newHalf = greyR + padding;

const minX = cx - newHalf;
const minY = cy - newHalf;
const size = newHalf * 2;

svgEl.attr("viewBox", `${minX} ${minY} ${size} ${size}`);
svgEl.attr("preserveAspectRatio", "xMidYMid meet");

svgEl.find("line").each((_, node) => {
  const el = $(node);

  const stroke = (el.attr("stroke") ?? "").trim().toLowerCase();
  if (stroke !== "black" && stroke !== "#000" && stroke !== "#000000") return;

  const x1 = Number.parseFloat(el.attr("x1") ?? "");
  const y1 = Number.parseFloat(el.attr("y1") ?? "");
  const x2 = Number.parseFloat(el.attr("x2") ?? "");
  const y2 = Number.parseFloat(el.attr("y2") ?? "");
  if (![x1, y1, x2, y2].every(Number.isFinite)) return;

  // Direction from center to one endpoint (use the farther endpoint for stability)
  const d1 = Math.hypot(x1 - cx, y1 - cy);
  const d2 = Math.hypot(x2 - cx, y2 - cy);
  const px = d2 >= d1 ? x2 : x1;
  const py = d2 >= d1 ? y2 : y1;

  let dx = px - cx;
  let dy = py - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  dx /= len;
  dy /= len;

  // New endpoints at the grey circle boundary
  const strokeW = 2; // must match your stroke-width
const effectiveR = greyR - strokeW / 2;

const nx1 = cx - dx * effectiveR;
const ny1 = cy - dy * effectiveR;
const nx2 = cx + dx * effectiveR;
const ny2 = cy + dy * effectiveR;

  el.attr("x1", String(nx1));
  el.attr("y1", String(ny1));
  el.attr("x2", String(nx2));
  el.attr("y2", String(ny2));

  // Style (white + consistent stroke rendering)
  el.attr("stroke", "#ffffff");
  el.attr("stroke-width", "2"); // adjust if you want thinner
  el.attr("vector-effect", "non-scaling-stroke");
});

  ensurePwlgLabelsAndPercents($, svgEl, meta);
  ensureDottedOutlineWithGaps($, svgEl, meta);
  ensureDottedOutlineLogos($, svgEl, meta);

  svgEl.find("#radar-labels-outer").remove();
  svgEl.find("#radar-connectors").remove();

  appendOuterGreyRingLabels($, svgEl, meta, normalizedBubbles);
  applyBubbleBreathingSpace($, svgEl, meta);
  replaceBubbleCirclesWithImages($, svgEl, warnings, normalizedBubbles);
  drawStraightBubbleLabelConnectors($, svgEl, meta, normalizedBubbles);
  normalizeRadarLayerOrder($, svgEl);

  // remove PWLG compass labels
  const unwanted = new Set(["P", "W", "G", "L"]);

  svgEl.find("text").each((_, el) => {
    const t = $(el).text().trim();

    if (unwanted.has(t)) {
      console.log("Removing PWLG label:", t);
      $(el).remove();
    }
  });

  console.log("PWLG cleanup complete");

  return { svg: $.xml(svgEl), bubbles: collectBubbleOutput($, svgEl), warnings };
}
