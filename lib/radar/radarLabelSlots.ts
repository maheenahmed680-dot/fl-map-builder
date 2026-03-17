type Point = {
  x: number;
  y: number;
};

export type RadarLabelSide = "left" | "right" | "top" | "bottom";

export type RadarTextAnchor = "start" | "middle" | "end";

export type RadarGeometry = {
  center: Point;
  frameRadius: number;
  greyRingRadius: number;
  labelGuideRadius: number;
  slotSpanX: number;
  slotSpanY: number;
};

export type RadarLabelSlot = {
  id: string;
  side: RadarLabelSide;
  sideIndex: number;
  sideCount: number;
  angle: number;
  textAnchor: RadarTextAnchor;
  labelAnchor: Point;
  connectorAnchor: Point;
};

export type RadarRenderedConnector = {
  pathData: string | null;
  stroke: string | null;
  strokeWidth: string | null;
  opacity: string | null;
};

export type RadarRenderedLabel = {
  selectionKey: string;
  clusterId: string | null;
  trend: string | null;
  text: string;
  theta: number;
  side: RadarLabelSide;
  textAnchor: RadarTextAnchor;
  labelAnchor: Point;
  bubbleAnchor: Point | null;
  connector: RadarRenderedConnector | null;
  fontFamily: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  fill: string | null;
  dominantBaseline: string | null;
};

const RADAR_LABEL_SIDES: RadarLabelSide[] = ["left", "right", "top", "bottom"];
const MIN_SLOTS_PER_SIDE = 2;

type SideCounts = Record<RadarLabelSide, number>;

function normalizeSvgValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toSelectionKey(clusterId: string | null, trend: string | null, tooltip?: string | null) {
  // Return raw value without prefix — must match getNodeSelectionKey() in TrendRadarPreview
  return clusterId ?? trend ?? tooltip ?? null;
}

function toFiniteNumber(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSvgMarkup(svgMarkup: string) {
  if (!svgMarkup.trim()) return null;

  const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  return parsed.querySelector<SVGSVGElement>("svg");
}

function createEmptySideCounts(): SideCounts {
  return {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
}

function classifySide(point: Point, center: Point): RadarLabelSide {
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

function projectPointToRadius(point: Point, center: Point, radius: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 0) {
    return { x: center.x, y: center.y - radius };
  }

  const scale = radius / distance;
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function getEvenlyDistributedOffset(index: number, count: number) {
  if (count <= 1) return 0;
  return (index / (count - 1)) * 2 - 1;
}

function getTargetSlotCount(labelCount: number) {
  const extraSlots = Math.max(4, Math.ceil(labelCount * 0.35));
  return Math.max(MIN_SLOTS_PER_SIDE * RADAR_LABEL_SIDES.length, labelCount + extraSlots);
}

function collectObservedSideCounts(svg: SVGSVGElement, geometry: RadarGeometry): SideCounts {
  return Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text")).reduce<SideCounts>(
    (counts, node) => {
      const x = toFiniteNumber(node.getAttribute("x"));
      const y = toFiniteNumber(node.getAttribute("y"));
      if (x == null || y == null) return counts;

      counts[classifySide({ x, y }, geometry.center)] += 1;
      return counts;
    },
    createEmptySideCounts(),
  );
}

function allocateSlotsBySide(targetSlotCount: number, observedSideCounts: SideCounts): SideCounts {
  const slotCounts = RADAR_LABEL_SIDES.reduce<SideCounts>((counts, side) => {
    counts[side] = MIN_SLOTS_PER_SIDE;
    return counts;
  }, createEmptySideCounts());

  let remainingSlots = targetSlotCount - MIN_SLOTS_PER_SIDE * RADAR_LABEL_SIDES.length;
  if (remainingSlots <= 0) {
    return slotCounts;
  }

  const weights = RADAR_LABEL_SIDES.map((side) => observedSideCounts[side] + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const provisional = RADAR_LABEL_SIDES.map((side, index) => {
    const share = (weights[index] / totalWeight) * remainingSlots;
    const whole = Math.floor(share);
    slotCounts[side] += whole;

    return {
      side,
      whole,
      remainder: share - whole,
    };
  });

  remainingSlots -= provisional.reduce((sum, item) => sum + item.whole, 0);
  provisional
    .sort((left, right) => {
      if (right.remainder !== left.remainder) {
        return right.remainder - left.remainder;
      }

      return RADAR_LABEL_SIDES.indexOf(left.side) - RADAR_LABEL_SIDES.indexOf(right.side);
    })
    .slice(0, remainingSlots)
    .forEach(({ side }) => {
      slotCounts[side] += 1;
    });

  return slotCounts;
}

function buildSlot(side: RadarLabelSide, sideIndex: number, sideCount: number, geometry: RadarGeometry): RadarLabelSlot {
  const offset = getEvenlyDistributedOffset(sideIndex, sideCount);
  const { center, greyRingRadius, labelGuideRadius, slotSpanX, slotSpanY } = geometry;

  let labelAnchor: Point;
  let textAnchor: RadarTextAnchor;

  switch (side) {
    case "left":
      labelAnchor = {
        x: center.x - labelGuideRadius,
        y: center.y + offset * slotSpanY,
      };
      textAnchor = "end";
      break;
    case "right":
      labelAnchor = {
        x: center.x + labelGuideRadius,
        y: center.y + offset * slotSpanY,
      };
      textAnchor = "start";
      break;
    case "top":
      labelAnchor = {
        x: center.x + offset * slotSpanX,
        y: center.y - labelGuideRadius,
      };
      textAnchor = "middle";
      break;
    case "bottom":
      labelAnchor = {
        x: center.x + offset * slotSpanX,
        y: center.y + labelGuideRadius,
      };
      textAnchor = "middle";
      break;
  }

  const connectorAnchor = projectPointToRadius(labelAnchor, center, greyRingRadius);

  return {
    id: `slot-${side}-${String(sideIndex + 1).padStart(2, "0")}`,
    side,
    sideIndex,
    sideCount,
    angle: Math.atan2(connectorAnchor.y - center.y, connectorAnchor.x - center.x),
    textAnchor,
    labelAnchor,
    connectorAnchor,
  };
}

function getBubbleAnchor(node: SVGElement): Point | null {
  const tagName = node.tagName.toLowerCase();

  if (tagName === "image") {
    const x = toFiniteNumber(node.getAttribute("x"));
    const y = toFiniteNumber(node.getAttribute("y"));
    const width = toFiniteNumber(node.getAttribute("width"));
    const height = toFiniteNumber(node.getAttribute("height"));
    if (x == null || y == null || width == null || height == null) return null;

    return {
      x: x + width / 2,
      y: y + height / 2,
    };
  }

  const cx = toFiniteNumber(node.getAttribute("cx"));
  const cy = toFiniteNumber(node.getAttribute("cy"));
  if (cx == null || cy == null) return null;

  return { x: cx, y: cy };
}

function getConnectorStartPoint(node: SVGElement) {
  const tagName = node.tagName.toLowerCase();

  if (tagName === "path") {
    const d = node.getAttribute("d") ?? "";
    const match = d.match(/M\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)/i);
    if (!match) return null;

    const x = Number.parseFloat(match[1]);
    const y = Number.parseFloat(match[2]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  if (tagName === "line") {
    const x = toFiniteNumber(node.getAttribute("x1"));
    const y = toFiniteNumber(node.getAttribute("y1"));
    return x != null && y != null ? { x, y } : null;
  }

  if (tagName === "polyline") {
    const firstPoint = (node.getAttribute("points") ?? "").trim().split(/\s+/)[0] ?? "";
    const [xRaw, yRaw] = firstPoint.split(",");
    const x = toFiniteNumber(xRaw);
    const y = toFiniteNumber(yRaw);
    return x != null && y != null ? { x, y } : null;
  }

  return null;
}

function isAdjacentSide(preferredSide: RadarLabelSide, candidateSide: RadarLabelSide) {
  if (preferredSide === "left" || preferredSide === "right") {
    return candidateSide === "top" || candidateSide === "bottom";
  }

  return candidateSide === "left" || candidateSide === "right";
}

export function classifyRadarLabelSideFromTheta(theta: number): RadarLabelSide {
  return classifySide({ x: Math.cos(theta), y: Math.sin(theta) }, { x: 0, y: 0 });
}

export function getRadarCandidateSides(
  preferredSide: RadarLabelSide,
  theta: number,
  currentSlotSide: RadarLabelSide | null = null,
): RadarLabelSide[] {
  const nextSides: RadarLabelSide[] = [preferredSide];
  const x = Math.cos(theta);
  const y = Math.sin(theta);

  let overflowSide: RadarLabelSide | null = null;
  if (preferredSide === "left" || preferredSide === "right") {
    if (Math.abs(y) >= 0.42) {
      overflowSide = y < 0 ? "top" : "bottom";
    }
  } else if (Math.abs(x) >= 0.42) {
    overflowSide = x < 0 ? "left" : "right";
  }

  if (overflowSide) {
    nextSides.push(overflowSide);
  }

  if (currentSlotSide && currentSlotSide !== preferredSide && isAdjacentSide(preferredSide, currentSlotSide)) {
    nextSides.push(currentSlotSide);
  }

  return nextSides.filter((side, index) => nextSides.indexOf(side) === index);
}

export function indexRadarLabelSlotsById(slots: RadarLabelSlot[]) {
  return slots.reduce<Record<string, RadarLabelSlot>>((index, slot) => {
    index[slot.id] = slot;
    return index;
  }, {});
}

export function findNearestRadarLabelSlot(labelAnchor: Point, slots: RadarLabelSlot[]) {
  if (!slots.length) return null;

  return slots.reduce<RadarLabelSlot | null>((closestSlot, slot) => {
    if (!closestSlot) return slot;

    const closestDistance = Math.hypot(
      closestSlot.labelAnchor.x - labelAnchor.x,
      closestSlot.labelAnchor.y - labelAnchor.y,
    );
    const nextDistance = Math.hypot(
      slot.labelAnchor.x - labelAnchor.x,
      slot.labelAnchor.y - labelAnchor.y,
    );

    return nextDistance < closestDistance ? slot : closestSlot;
  }, null);
}

export function readRadarGeometryFromSvg(svg: SVGSVGElement): RadarGeometry | null {
  const centerX = toFiniteNumber(svg.getAttribute("data-radar-center-x"));
  const centerY = toFiniteNumber(svg.getAttribute("data-radar-center-y"));
  const frameRadius = toFiniteNumber(svg.getAttribute("data-radar-frame-radius"));
  const greyRingRadius = toFiniteNumber(svg.getAttribute("data-radar-grey-r"));

  if (centerX == null || centerY == null || frameRadius == null || greyRingRadius == null) {
    return null;
  }

  // Labels are placed at R_start_safe ≈ min(tealR3 + 32, greyR − 22) by the transform pipeline.
  // Previously this used greyRingRadius + margin which put slots *outside* the grey ring.
  const tealR3 = toFiniteNumber(svg.getAttribute("data-radar-teal-r3")) ?? frameRadius;
  const labelGuideRadius = Math.min(tealR3 + 32, greyRingRadius - 22);
  const slotSpanX = Math.max(frameRadius * 0.7, greyRingRadius * 0.5);
  const slotSpanY = Math.max(frameRadius * 0.68, greyRingRadius * 0.48);

  return {
    center: { x: centerX, y: centerY },
    frameRadius,
    greyRingRadius,
    labelGuideRadius,
    slotSpanX,
    slotSpanY,
  };
}

export function readRadarGeometryFromSvgMarkup(svgMarkup: string) {
  const svg = parseSvgMarkup(svgMarkup);
  return svg ? readRadarGeometryFromSvg(svg) : null;
}

export function generateRadarLabelSlotsFromSvg(svg: SVGSVGElement): RadarLabelSlot[] {
  const geometry = readRadarGeometryFromSvg(svg);
  if (!geometry) return [];

  const observedLabelCount = svg.querySelectorAll("#radar-labels-outer text").length;
  const targetSlotCount = getTargetSlotCount(observedLabelCount);
  const observedSideCounts = collectObservedSideCounts(svg, geometry);
  const slotCountsBySide = allocateSlotsBySide(targetSlotCount, observedSideCounts);

  return RADAR_LABEL_SIDES.flatMap((side) =>
    Array.from({ length: slotCountsBySide[side] }, (_, sideIndex) =>
      buildSlot(side, sideIndex, slotCountsBySide[side], geometry),
    ),
  );
}

export function generateRadarLabelSlotsFromSvgMarkup(svgMarkup: string): RadarLabelSlot[] {
  const svg = parseSvgMarkup(svgMarkup);
  return svg ? generateRadarLabelSlotsFromSvg(svg) : [];
}

export function readRadarRenderedLabelsFromSvg(svg: SVGSVGElement) {
  const geometry = readRadarGeometryFromSvg(svg);
  if (!geometry) return {} as Record<string, RadarRenderedLabel>;

  const bubbleAnchorByKey = Array.from(svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble")).reduce<
    Record<string, Point>
  >((index, node) => {
    const clusterId = normalizeSvgValue(node.getAttribute("data-cluster-id"));
    const trend = normalizeSvgValue(node.getAttribute("data-trend"));
    const tooltip = normalizeSvgValue(node.getAttribute("data-tooltip"));
    const selectionKey = toSelectionKey(clusterId, trend, tooltip);
    const bubbleAnchor = getBubbleAnchor(node);

    if (selectionKey && bubbleAnchor) {
      index[selectionKey] = bubbleAnchor;
    }

    return index;
  }, {});

  const connectorNodes = Array.from(
    svg.querySelectorAll<SVGElement>("#radar-connectors path, #radar-connectors line, #radar-connectors polyline"),
  );

  return Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text")).reduce<
    Record<string, RadarRenderedLabel>
  >((index, node) => {
    const clusterId = normalizeSvgValue(node.getAttribute("data-cluster-id"));
    const trend = normalizeSvgValue(node.getAttribute("data-trend"));
    const selectionKey = toSelectionKey(clusterId, trend);
    const x = toFiniteNumber(node.getAttribute("x"));
    const y = toFiniteNumber(node.getAttribute("y"));

    if (!selectionKey || x == null || y == null) return index;

    const theta =
      toFiniteNumber(node.getAttribute("data-label-theta")) ??
      Math.atan2(y - geometry.center.y, x - geometry.center.x);
    const bubbleAnchor = bubbleAnchorByKey[selectionKey] ?? null;
    const matchedConnector =
      bubbleAnchor == null
        ? null
        : connectorNodes.find((connectorNode) => {
            const startPoint = getConnectorStartPoint(connectorNode);
            if (!startPoint) return false;

            return Math.abs(startPoint.x - bubbleAnchor.x) <= 0.75 && Math.abs(startPoint.y - bubbleAnchor.y) <= 0.75;
          }) ?? null;

    index[selectionKey] = {
      selectionKey,
      clusterId,
      trend,
      text: normalizeSvgValue(node.textContent) ?? trend ?? "",
      theta,
      side: classifyRadarLabelSideFromTheta(theta),
      textAnchor: (normalizeSvgValue(node.getAttribute("text-anchor")) as RadarTextAnchor | null) ?? "start",
      labelAnchor: { x, y },
      bubbleAnchor,
      connector: matchedConnector
        ? {
            pathData: matchedConnector.tagName.toLowerCase() === "path" ? matchedConnector.getAttribute("d") : null,
            stroke: normalizeSvgValue(matchedConnector.getAttribute("stroke")),
            strokeWidth: normalizeSvgValue(matchedConnector.getAttribute("stroke-width")),
            opacity: normalizeSvgValue(matchedConnector.getAttribute("opacity")),
          }
        : null,
      fontFamily: normalizeSvgValue(node.getAttribute("font-family")),
      fontSize: normalizeSvgValue(node.getAttribute("font-size")),
      fontWeight: normalizeSvgValue(node.getAttribute("font-weight")),
      fill: normalizeSvgValue(node.getAttribute("fill")),
      dominantBaseline: normalizeSvgValue(node.getAttribute("dominant-baseline")),
    };

    return index;
  }, {});
}

export function readRadarRenderedLabelsFromSvgMarkup(svgMarkup: string) {
  const svg = parseSvgMarkup(svgMarkup);
  return svg ? readRadarRenderedLabelsFromSvg(svg) : {};
}

// ---------------------------------------------------------------------------
// BBox-based arc candidate slot generation
// ---------------------------------------------------------------------------

export type LabelBBox = {
  clusterId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Distance from a point to the nearest edge of an axis-aligned rectangle. Returns 0 if point is inside. */
export function distancePointToRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): number {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return Math.hypot(dx, dy);
}

const BBOX_ARC_SAMPLE_COUNT = 48;
const BBOX_ARC_LABEL_CLEARANCE = 32;
const BBOX_ARC_SLOT_CLEARANCE = 22;
const BBOX_ARC_MAX_SLOTS = 10;
const BBOX_ARC_MIN_SURVIVE = 5;
const BBOX_ARC_CONNECTOR_INSET = 8;
const BBOX_ARC_LABEL_OUTWARD_OFFSET = 14; // push label text outward from dot

/**
 * Generates candidate label slots along the outer label ring arc using
 * actual rendered bounding boxes (from getBBox()) for collision detection.
 *
 * Algorithm:
 *  1. Sample 48 angles within ±90° of the selected bubble's angle
 *  2. Discard candidates within 32px of any existing label bounding box
 *  3. Discard candidates within 22px of another already-accepted slot
 *  4. If fewer than 5 survive, widen to ±135° and retry
 *  5. Sort by distance from bubble, keep maximum 10 candidates
 *  6. Exclude the candidate closest to the selected bubble's current label position
 */
export function buildBBoxFilteredArcSlots({
  geometry,
  labelBBoxes,
  selectedClusterId,
  currentLabelTheta,
  bubbleTheta,
}: {
  geometry: RadarGeometry;
  labelBBoxes: LabelBBox[];
  selectedClusterId: string;
  currentLabelTheta: number | null;
  bubbleTheta: number;
}): RadarLabelSlot[] {
  const r = geometry.labelGuideRadius;
  const { center } = geometry;

  // Exclude the selected label's own bbox
  const otherBBoxes = labelBBoxes.filter((b) => b.clusterId !== selectedClusterId);

  function sampleAndFilter(halfRange: number): Array<{ theta: number; point: Point }> {
    // Generate candidates centered around bubbleTheta within ±halfRange
    const rawCandidates: Array<{ theta: number; point: Point }> = [];
    for (let i = 0; i < BBOX_ARC_SAMPLE_COUNT; i++) {
      const ratio = BBOX_ARC_SAMPLE_COUNT <= 1 ? 0.5 : i / (BBOX_ARC_SAMPLE_COUNT - 1);
      const theta = normalizeAngleLocal(bubbleTheta - halfRange + ratio * halfRange * 2);
      rawCandidates.push({
        theta,
        point: { x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) },
      });
    }

    // Skip if too close to the current label position
    const afterCurrentFilter = rawCandidates.filter(
      (c) => currentLabelTheta == null || angularDistance(c.theta, currentLabelTheta) >= 0.05,
    );

    // Discard candidates within LABEL_CLEARANCE of any label bbox
    const afterLabelFilter = afterCurrentFilter.filter((c) =>
      otherBBoxes.every(
        (bbox) =>
          distancePointToRect(c.point.x, c.point.y, bbox.x, bbox.y, bbox.width, bbox.height) >= BBOX_ARC_LABEL_CLEARANCE,
      ),
    );

    // Discard candidates within SLOT_CLEARANCE of another already-accepted slot
    const accepted: typeof afterLabelFilter = [];
    for (const c of afterLabelFilter) {
      if (accepted.every((a) => Math.hypot(a.point.x - c.point.x, a.point.y - c.point.y) >= BBOX_ARC_SLOT_CLEARANCE)) {
        accepted.push(c);
      }
    }

    return accepted;
  }

  // First pass: ±90° (180° arc around bubble)
  let result = sampleAndFilter(Math.PI / 2);

  // If too few survive, widen to ±135°
  if (result.length < BBOX_ARC_MIN_SURVIVE) {
    result = sampleAndFilter((3 * Math.PI) / 4);
  }

  // Sort by angular distance from bubble (closest first), then cap
  result.sort((a, b) => angularDistance(a.theta, bubbleTheta) - angularDistance(b.theta, bubbleTheta));
  result = result.slice(0, BBOX_ARC_MAX_SLOTS);

  // Exclude the candidate closest to the selected bubble's own current label position
  if (currentLabelTheta != null && result.length > 1) {
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < result.length; i++) {
      const dist = angularDistance(result[i].theta, currentLabelTheta);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    result = result.filter((_, i) => i !== closestIdx);
  }

  return result.map((c, i) => ({
    id: `arc:${Math.round(c.theta * 10000)}`,
    side: classifyRadarLabelSideFromTheta(c.theta),
    sideIndex: i,
    sideCount: result.length,
    angle: c.theta,
    textAnchor: getTextAnchorForAngle(c.theta),
    labelAnchor: {
      x: center.x + (r + BBOX_ARC_LABEL_OUTWARD_OFFSET) * Math.cos(c.theta),
      y: center.y + (r + BBOX_ARC_LABEL_OUTWARD_OFFSET) * Math.sin(c.theta),
    },
    connectorAnchor: {
      x: center.x + (r - BBOX_ARC_CONNECTOR_INSET) * Math.cos(c.theta),
      y: center.y + (r - BBOX_ARC_CONNECTOR_INSET) * Math.sin(c.theta),
    },
  }));
}

// ---------------------------------------------------------------------------
// Gap-based slot generation — places dots ONLY in empty stretches of the ring
// ---------------------------------------------------------------------------

type AngularRange = { start: number; end: number };

const GAP_OCCUPANCY_MARGIN = 0.02; // ~1.1° margin on each side of a label (~4px at 200px radius)
const GAP_MIN_WIDTH = 0.04; // minimum gap width in radians (~2.3°, ~8px at 200px radius)
const GAP_EDGE_INSET = 0.015; // inset from gap edges for dot placement (~3px)
const GAP_MAX_SLOTS = 15;
const GAP_SLOT_CLEARANCE = 18; // px between slots
const GAP_CONNECTOR_INSET = 8;
const GAP_LABEL_OUTWARD_OFFSET = 14;

/**
 * Compute the angular range a bounding box occupies as seen from the radar center.
 * Returns one or two ranges (two if the bbox straddles the -π/+π boundary).
 */
function computeAngularOccupancy(
  bbox: LabelBBox,
  center: Point,
  margin: number,
): AngularRange[] {
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x, y: bbox.y + bbox.height },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
  ];

  const angles = corners.map((c) => Math.atan2(c.y - center.y, c.x - center.x));

  let minA = angles[0];
  let maxA = angles[0];
  for (let i = 1; i < angles.length; i++) {
    if (angles[i] < minA) minA = angles[i];
    if (angles[i] > maxA) maxA = angles[i];
  }

  // Check if the bbox straddles the -π/+π boundary:
  // If the angular span is > π, the bbox wraps around the discontinuity
  if (maxA - minA > Math.PI) {
    // Split: negative angles form one range, positive angles form another
    const negAngles = angles.filter((a) => a < 0);
    const posAngles = angles.filter((a) => a >= 0);
    const ranges: AngularRange[] = [];
    if (posAngles.length > 0) {
      ranges.push({
        start: Math.min(...posAngles) - margin,
        end: Math.PI,
      });
    }
    if (negAngles.length > 0) {
      ranges.push({
        start: -Math.PI,
        end: Math.max(...negAngles) + margin,
      });
    }
    return ranges;
  }

  return [{ start: minA - margin, end: maxA + margin }];
}

/**
 * Merge overlapping angular ranges into consolidated intervals.
 * Input ranges should use (-π, π] angles. Returns sorted, merged ranges.
 */
function mergeAngularRanges(ranges: AngularRange[]): AngularRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: AngularRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }

  return merged;
}

/**
 * Find angular gaps (empty stretches) as the complement of occupied ranges.
 * Returns gap ranges within [-π, π], excluding gaps narrower than minGapWidth.
 */
function findAngularGaps(occupied: AngularRange[], minGapWidth: number): AngularRange[] {
  if (occupied.length === 0) {
    return [{ start: -Math.PI, end: Math.PI }];
  }

  const gaps: AngularRange[] = [];

  // Gap before first occupied range (wrapping from end of circle)
  if (occupied[0].start > -Math.PI) {
    const gapWidth = occupied[0].start - (-Math.PI);
    if (gapWidth >= minGapWidth) {
      gaps.push({ start: -Math.PI, end: occupied[0].start });
    }
  }

  // Gaps between consecutive occupied ranges
  for (let i = 0; i < occupied.length - 1; i++) {
    const gapStart = occupied[i].end;
    const gapEnd = occupied[i + 1].start;
    if (gapEnd - gapStart >= minGapWidth) {
      gaps.push({ start: gapStart, end: gapEnd });
    }
  }

  // Gap after last occupied range (wrapping to start of circle)
  const lastEnd = occupied[occupied.length - 1].end;
  if (lastEnd < Math.PI) {
    const gapWidth = Math.PI - lastEnd;
    if (gapWidth >= minGapWidth) {
      gaps.push({ start: lastEnd, end: Math.PI });
    }
  }

  return gaps;
}

/**
 * Distribute slot positions evenly within a gap, respecting minimum angular spacing.
 */
function distributeInGap(gapStart: number, gapEnd: number, minAngularSpacing: number): number[] {
  const insetStart = gapStart + GAP_EDGE_INSET;
  const insetEnd = gapEnd - GAP_EDGE_INSET;
  if (insetEnd <= insetStart) return [];

  const usableWidth = insetEnd - insetStart;
  const maxSlots = Math.max(1, Math.floor(usableWidth / minAngularSpacing) + 1);
  const count = Math.min(maxSlots, Math.max(1, Math.round(usableWidth / minAngularSpacing)));

  const thetas: number[] = [];
  if (count === 1) {
    thetas.push((insetStart + insetEnd) / 2);
  } else {
    const step = usableWidth / (count - 1);
    for (let i = 0; i < count; i++) {
      thetas.push(insetStart + i * step);
    }
  }

  return thetas;
}

/**
 * Gap-based slot generation: scans the ENTIRE ring for empty stretches
 * and places slot dots ONLY in those gaps.
 *
 * Unlike the old bubble-centric algorithm, this does NOT favor positions
 * near the selected bubble. It finds ALL available space on the ring.
 */
const GAP_QUADRANT_HALF_RANGE = (3 * Math.PI) / 4; // ±135° = 3 quadrants around bubble

export function buildGapBasedSlots({
  geometry,
  labelBBoxes,
  selectedClusterId,
  bubbleTheta,
}: {
  geometry: RadarGeometry;
  labelBBoxes: LabelBBox[];
  selectedClusterId: string;
  bubbleTheta: number;
}): RadarLabelSlot[] {
  const r = geometry.labelGuideRadius;
  const { center } = geometry;

  // Exclude the selected label's own bbox — its position is what we're relocating
  const otherBBoxes = labelBBoxes.filter((b) => b.clusterId !== selectedClusterId);

  // Step 1: Convert each label bbox to angular occupancy ranges
  const allRanges: AngularRange[] = [];
  for (const bbox of otherBBoxes) {
    const ranges = computeAngularOccupancy(bbox, center, GAP_OCCUPANCY_MARGIN);
    allRanges.push(...ranges);
  }

  // Step 2: Merge overlapping occupied ranges
  const occupied = mergeAngularRanges(allRanges);

  // Step 3: Find gaps (empty stretches)
  const allGaps = findAngularGaps(occupied, GAP_MIN_WIDTH);

  // Step 3b: Filter gaps to bubble's quadrant ± adjacent quadrants (±135°)
  // Only keep gaps whose midpoint is within ±135° of the bubble
  const gaps = allGaps.filter((gap) => {
    const gapMid = (gap.start + gap.end) / 2;
    return angularDistance(gapMid, bubbleTheta) <= GAP_QUADRANT_HALF_RANGE;
  });

  // Step 4: Distribute slots within gaps
  const minAngularSpacing = GAP_SLOT_CLEARANCE / r;
  let allThetas: number[] = [];
  for (const gap of gaps) {
    const thetas = distributeInGap(gap.start, gap.end, minAngularSpacing);
    allThetas.push(...thetas);
  }

  // Step 5: Cap total slots, prioritizing positions closest to the bubble
  allThetas.sort((a, b) => angularDistance(a, bubbleTheta) - angularDistance(b, bubbleTheta));
  if (allThetas.length > GAP_MAX_SLOTS) {
    allThetas = allThetas.slice(0, GAP_MAX_SLOTS);
  }

  // Step 6: Build RadarLabelSlot objects
  return allThetas.map((theta, i) => ({
    id: `gap:${Math.round(theta * 10000)}`,
    side: classifyRadarLabelSideFromTheta(theta),
    sideIndex: i,
    sideCount: allThetas.length,
    angle: theta,
    textAnchor: getTextAnchorForAngle(theta),
    labelAnchor: {
      x: center.x + (r + GAP_LABEL_OUTWARD_OFFSET) * Math.cos(theta),
      y: center.y + (r + GAP_LABEL_OUTWARD_OFFSET) * Math.sin(theta),
    },
    connectorAnchor: {
      x: center.x + (r - GAP_CONNECTOR_INSET) * Math.cos(theta),
      y: center.y + (r - GAP_CONNECTOR_INSET) * Math.sin(theta),
    },
  }));
}

// ---------------------------------------------------------------------------
// Legacy arc-based candidate slot generation (angular-distance filtering)
// ---------------------------------------------------------------------------

/** Estimates the rendered pixel width of a label at a given font size. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  return Math.max(fontSize * 2.6, text.length * fontSize * 0.56);
}

/** Normalizes an angle to (−π, π]. */
function normalizeAngleLocal(theta: number): number {
  let value = theta;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

/** Returns the smallest angular distance between two angles, in [0, π]. */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngleLocal(a) - normalizeAngleLocal(b));
  return Math.min(diff, 2 * Math.PI - diff);
}

/** Returns the text-anchor appropriate for a given angle on the arc. */
export function getTextAnchorForAngle(theta: number): RadarTextAnchor {
  const deg = (((theta * 180) / Math.PI) % 360 + 360) % 360;
  return deg > 90 && deg < 270 ? "end" : "start";
}

export type ArcCandidatePlacement = {
  clusterId: string;
  labelAnchor: Point;
  text: string;
  fontSize: number;
  textAnchor: string;
};

const ARC_DESIRED_COUNT = 7;
const ARC_MAX_COUNT = 8;
const ARC_MIN_COUNT = 5;
const ARC_CONNECTOR_INSET = 8; // px inset from labelAnchor towards center
const ARC_DOT_RADIUS = 10; // SVG units — visual dot radius on the arc
const ARC_ANGLE_BUFFER = 0.025; // ~1.4° extra clearance between slots

/**
 * Generates candidate label slots along the outer label ring arc using polar
 * sampling. Replaces the broken Cartesian lane-based approach.
 *
 * Strategy:
 *  1. Sample N angles evenly across [bubbleTheta ± π/2] (180° around the bubble)
 *  2. Filter out angles angularly too close to any existing label
 *  3. If fewer than ARC_MIN_COUNT survive, widen to ±3π/4 and retry
 *  4. Return the best desiredCount candidates, sorted closest-to-bubble first
 */
export function buildArcCandidateSlots({
  bubbleTheta,
  geometry,
  existingPlacements,
  selectedClusterId,
  selectedText,
  selectedFontSize,
  currentLabelTheta = null,
  desiredCount = ARC_DESIRED_COUNT,
}: {
  bubbleTheta: number;
  geometry: RadarGeometry;
  existingPlacements: ArcCandidatePlacement[];
  selectedClusterId: string;
  selectedText: string;
  selectedFontSize: number;
  currentLabelTheta?: number | null;
  desiredCount?: number;
}): RadarLabelSlot[] {
  const r = geometry.labelGuideRadius;
  const { center } = geometry;

  // Half-arc width of the selected label at this radius
  const selectedHalfArc = estimateLabelWidth(selectedText, selectedFontSize) / (2 * r);

  // Filter existing placements (exclude the selected label itself)
  const others = existingPlacements.filter((p) => p.clusterId !== selectedClusterId);

  // Precompute existing thetas + their half-arcs once
  const existingEntries = others.map((p) => ({
    theta: Math.atan2(p.labelAnchor.y - center.y, p.labelAnchor.x - center.x),
    halfArc: estimateLabelWidth(p.text, p.fontSize) / (2 * r),
  }));

  function sampleArc(halfRange: number, sampleCount: number): RadarLabelSlot[] {
    const candidates: RadarLabelSlot[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const ratio = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
      const theta = normalizeAngleLocal(bubbleTheta - halfRange + ratio * halfRange * 2);

      // Skip if too close to the current label position
      if (currentLabelTheta != null && angularDistance(theta, currentLabelTheta) < 0.05) {
        continue;
      }

      // Skip if overlaps with any existing label (account for dot radius too)
      const dotHalfArc = ARC_DOT_RADIUS / r;
      const overlaps = existingEntries.some((entry) => {
        const minGap = entry.halfArc + Math.max(selectedHalfArc, dotHalfArc) + ARC_ANGLE_BUFFER;
        return angularDistance(theta, entry.theta) < minGap;
      });
      if (overlaps) continue;

      const labelAnchor: Point = {
        x: center.x + r * Math.cos(theta),
        y: center.y + r * Math.sin(theta),
      };
      const connectorAnchor: Point = {
        x: center.x + (r - ARC_CONNECTOR_INSET) * Math.cos(theta),
        y: center.y + (r - ARC_CONNECTOR_INSET) * Math.sin(theta),
      };
      const side = classifyRadarLabelSideFromTheta(theta);
      const textAnchor = getTextAnchorForAngle(theta);

      candidates.push({
        id: `arc:${Math.round(theta * 10000)}`,
        side,
        sideIndex: i,
        sideCount: sampleCount,
        angle: theta,
        textAnchor,
        labelAnchor,
        connectorAnchor,
      });
    }

    return candidates;
  }

  // First pass: ±90° (180° total), 24 samples
  let candidates = sampleArc(Math.PI / 2, 24);

  // If too few, widen to ±135° with more samples
  if (candidates.length < ARC_MIN_COUNT) {
    candidates = sampleArc((3 * Math.PI) / 4, 30);
  }

  // Sort by angular distance from bubble (closest first), then cap
  candidates.sort((a, b) => angularDistance(a.angle, bubbleTheta) - angularDistance(b.angle, bubbleTheta));

  return candidates.slice(0, Math.min(desiredCount, ARC_MAX_COUNT));
}
