"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type TrendRadarPreviewProps = {
  onBubbleSelect: (selectionKey: string | null) => void;
  onToggleSidebar: () => void;
  selectedBubbleKey: string | null;
  sidebarOpen: boolean;
  svgMarkup: string;
  warnings: string[];
};

type Slot = { angle: number; x: number; y: number };

// Connector stroke colors per bubble type (mirrors transformTrendRadarHtml.ts)
const CONNECTOR_COLORS: Record<string, string> = {
  "Sehr hoch": "#0674B0",
  Hoch: "#18BEA9",
  Niedrig: "#7B61FF",
  "Sehr niedrig": "#FF4DA6",
};

const LABEL_OFFSET = 8; // px gap between outermost teal circle and label text
const SLOT_GAP_THRESHOLD_PX = 28; // minimum gap in px to place a slot between two labels

function normalizeSvgValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toBubbleSelectionKey(clusterId: string | null, trend: string | null) {
  if (clusterId) return `cluster:${clusterId}`;
  if (trend) return `trend:${trend}`;
  return null;
}

function getSelectableNode(target: Element | null) {
  return target?.closest(
    [
      "circle.bubble",
      "circle.trend-bubble",
      "circle[data-trend]",
      "image.bubble",
      "image.trend-bubble",
      "#radar-labels-outer text",
      "#radar-connectors path[data-trend]",
      "#radar-connectors path[data-cluster-id]",
      "#radar-connectors line[data-trend]",
      "#radar-connectors line[data-cluster-id]",
      "#radar-connectors polyline[data-trend]",
      "#radar-connectors polyline[data-cluster-id]",
    ].join(", "),
  ) ?? null;
}

/** Allow connector paths/lines to receive pointer events despite their parent group
 *  being created with pointer-events="none". Must be called each time innerHTML is set. */
function enableConnectorInteractivity(svg: Element) {
  svg.querySelectorAll<SVGElement>(
    "#radar-connectors path[data-trend], #radar-connectors path[data-cluster-id], " +
    "#radar-connectors line[data-trend], #radar-connectors line[data-cluster-id], " +
    "#radar-connectors polyline[data-trend], #radar-connectors polyline[data-cluster-id]",
  ).forEach((el) => el.setAttribute("pointer-events", "stroke"));
}

function parseSelectedBubbleKey(selectedBubbleKey: string | null) {
  if (!selectedBubbleKey) return { clusterId: null, trend: null };
  if (selectedBubbleKey.startsWith("cluster:")) {
    return {
      clusterId: normalizeSvgValue(selectedBubbleKey.slice("cluster:".length)),
      trend: null,
    };
  }
  if (selectedBubbleKey.startsWith("trend:")) {
    return {
      clusterId: null,
      trend: normalizeSvgValue(selectedBubbleKey.slice("trend:".length)),
    };
  }

  return { clusterId: null, trend: null };
}

function matchesSelectedNode(
  node: Element,
  selectedClusterId: string | null,
  selectedTrend: string | null,
) {
  const clusterId = normalizeSvgValue(node.getAttribute("data-cluster-id"));
  const trend = normalizeSvgValue(node.getAttribute("data-trend"));

  if (selectedClusterId) {
    return clusterId === selectedClusterId;
  }

  if (selectedTrend) {
    return trend === selectedTrend;
  }

  return false;
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
    const x = Number.parseFloat(node.getAttribute("x1") ?? "");
    const y = Number.parseFloat(node.getAttribute("y1") ?? "");
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  if (tagName === "polyline") {
    const firstPoint = (node.getAttribute("points") ?? "").trim().split(/\s+/)[0] ?? "";
    const [xRaw, yRaw] = firstPoint.split(",");
    const x = Number.parseFloat(xRaw ?? "");
    const y = Number.parseFloat(yRaw ?? "");
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  return null;
}

function normalizeAngle(a: number): number {
  let n = a % (2 * Math.PI);
  if (n > Math.PI) n -= 2 * Math.PI;
  if (n < -Math.PI) n += 2 * Math.PI;
  return n;
}

/** Apply label position at a given angle — mirrors applyOuterLabelPosition in transformTrendRadarHtml.ts */
function applyLabelPosition(
  label: SVGTextElement,
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

  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.setAttribute("text-anchor", anchor);
  label.setAttribute("transform", `rotate(${finalRotation} ${x} ${y})`);
  const tspan = label.querySelector('tspan');
  if (tspan) tspan.setAttribute('x', String(x));
}

function getQuadrant(angle: number): number {
  // Normalize to [0, 2π)
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  // Q0=right(-45°..45° → 315°..45°), Q1=bottom(45°..135°), Q2=left(135°..225°), Q3=top(225°..315°)
  const deg = (a * 180) / Math.PI;
  if (deg >= 315 || deg < 45) return 0;
  if (deg >= 45 && deg < 135) return 1;
  if (deg >= 135 && deg < 225) return 2;
  return 3; // 225..315
}

function isInAllowedArc(slotAngle: number, bubbleQuadrant: number): boolean {
  const slotQ = getQuadrant(slotAngle);
  const oppositeQ = (bubbleQuadrant + 2) % 4;
  return slotQ !== oppositeQ;
}

function readSvgRadii(svg: SVGSVGElement) {
  const R_tealOuter =
    Number.parseFloat(svg.getAttribute("data-radar-teal-r3") ?? "") ||
    Number.parseFloat(svg.getAttribute("data-radar-teal-r2") ?? "") ||
    Number.parseFloat(svg.getAttribute("data-radar-teal-r1") ?? "") ||
    0;
  const R_greyOuter = Number.parseFloat(svg.getAttribute("data-radar-grey-r") ?? "") || 0;
  return { R_tealOuter, R_greyOuter };
}

function readSvgCenter(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4) {
    return { cx: viewBox[0] + viewBox[2] / 2, cy: viewBox[1] + viewBox[3] / 2 };
  }
  return { cx: 500, cy: 500 };
}

function computeSlots(
  svg: SVGSVGElement,
  selectedClusterId: string | null,
  selectedTrend: string | null,
): Slot[] {
  const { R_tealOuter, R_greyOuter } = readSvgRadii(svg);
  if (!R_tealOuter || !R_greyOuter) return [];

  const { cx, cy } = readSvgCenter(svg);
  const R_slot = (R_tealOuter + R_greyOuter) / 2;
  const minGapAngle = SLOT_GAP_THRESHOLD_PX / R_slot;

  // Find the selected bubble's position
  const bubbleNodes = Array.from(
    svg.querySelectorAll<SVGCircleElement>("circle.bubble, circle.trend-bubble, circle[data-trend]"),
  );
  const bubbleNode = bubbleNodes.find((n) => matchesSelectedNode(n, selectedClusterId, selectedTrend));
  if (!bubbleNode) return [];

  const bx = Number.parseFloat(bubbleNode.getAttribute("cx") ?? "");
  const by = Number.parseFloat(bubbleNode.getAttribute("cy") ?? "");
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return [];

  const bubbleAngle = Math.atan2(by - cy, bx - cx);
  const bubbleQuadrant = getQuadrant(bubbleAngle);

  // Collect all label thetas, normalized to [0, 2π), sorted ascending
  const thetas: number[] = [];
  svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text[data-label-theta]").forEach((label) => {
    const raw = Number.parseFloat(label.getAttribute("data-label-theta") ?? "");
    if (!Number.isFinite(raw)) return;
    let t = raw % (2 * Math.PI);
    if (t < 0) t += 2 * Math.PI;
    thetas.push(t);
  });
  thetas.sort((a, b) => a - b);

  if (thetas.length === 0) return [];

  // Find gaps wider than minGapAngle; place a slot at each gap midpoint
  const candidates: number[] = [];
  for (let i = 0; i < thetas.length; i++) {
    const j = (i + 1) % thetas.length;
    let gap: number;
    if (j === 0) {
      // Wrap-around gap: from last theta to first theta + 2π
      gap = thetas[0] + 2 * Math.PI - thetas[thetas.length - 1];
    } else {
      gap = thetas[j] - thetas[i];
    }
    if (gap > minGapAngle) {
      let mid: number;
      if (j === 0) {
        mid = thetas[thetas.length - 1] + gap / 2;
        if (mid >= 2 * Math.PI) mid -= 2 * Math.PI;
      } else {
        mid = thetas[i] + gap / 2;
      }
      candidates.push(mid);
    }
  }

  // Apply opposite-quadrant exclusion
  const slots: Slot[] = [];
  for (const angle of candidates) {
    if (!isInAllowedArc(angle, bubbleQuadrant)) continue;
    slots.push({
      angle,
      x: cx + R_slot * Math.cos(angle),
      y: cy + R_slot * Math.sin(angle),
    });
  }

  return slots;
}

export function TrendRadarPreview({
  onBubbleSelect,
  onToggleSidebar,
  selectedBubbleKey,
  sidebarOpen,
  svgMarkup,
  warnings,
}: TrendRadarPreviewProps) {
  const DRAG_THRESHOLD_PX = 4;
  const [zoom, setZoom] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, number>>({});

  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const isDraggingRef = useRef(false);
  const appliedSelectionRef = useRef<{ clusterId: string | null; trend: string | null }>({ clusterId: null, trend: null });
  const labelOverridesRef = useRef<Record<string, number>>({});
  labelOverridesRef.current = labelOverrides;
  const suppressClickRef = useRef(false);
  const previewSvgRef = useRef<HTMLDivElement | null>(null);
  // Stable ref callback: fires only on mount. Sets innerHTML from the svgMarkup
  // value captured at mount time; svgMarkup changes are handled by the useEffect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const svgContainerRef = useCallback((node: HTMLDivElement | null) => {
    previewSvgRef.current = node;
    if (node) {
      node.innerHTML = svgMarkup;
      const svg = node.querySelector("svg");
      if (svg) enableConnectorInteractivity(svg);
    }
  }, []);

  const displayFont = { fontFamily: "Montserrat, Open Sans, Arial, sans-serif" } as const;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const prevSvgMarkupRef = useRef(svgMarkup);
  useEffect(() => {
    if (svgMarkup === prevSvgMarkupRef.current) return;
    prevSvgMarkupRef.current = svgMarkup;

    // svgMarkup changed — replace the SVG DOM manually (no dangerouslySetInnerHTML)
    if (previewSvgRef.current) {
      previewSvgRef.current.innerHTML = svgMarkup;
      const svg = previewSvgRef.current.querySelector("svg");
      if (svg) enableConnectorInteractivity(svg);
    }

    setZoom(1);
  setTranslateX(0);
  setTranslateY(0);
  setIsDragging(false);
  setSlots([]);
  setLabelOverrides({});
  dragStartRef.current = null;
  isDraggingRef.current = false;
  suppressClickRef.current = false;
}, [svgMarkup]);

  useEffect(() => {
    const root = previewSvgRef.current;
    if (!root) return;

    setTimeout(() => {
      const svg = root.querySelector("svg");
      if (!svg) return;

      svg.querySelectorAll("text").forEach((node) => {
        const t = node.textContent?.trim();
        if (["P", "W", "G", "L"].includes(t || "")) {
          node.remove();
        }
      });
    }, 0);
  }, [svgMarkup]);

  // Re-apply highlight + label overrides when svgMarkup changes (dangerouslySetInnerHTML replaces the SVG DOM)
  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector("svg");
    if (!svg) return;

    // Ensure connector paths are interactive after every SVG replacement
    enableConnectorInteractivity(svg);

    // 1. Restore selection highlight
    const { clusterId, trend } = appliedSelectionRef.current;
    applySelectionHighlight(svg, clusterId, trend);

    // 2. Restore all label + connector overrides
    const overrides = labelOverridesRef.current;
    if (Object.keys(overrides).length === 0) return;

    const { R_tealOuter } = readSvgRadii(svg as SVGSVGElement);
    const { cx, cy } = readSvgCenter(svg as SVGSVGElement);
    const labelRadius = R_tealOuter + LABEL_OFFSET;

    for (const [key, theta] of Object.entries(overrides)) {
      const { clusterId: oc, trend: ot } = parseSelectedBubbleKey(key);

      const label = Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text"))
        .find((n) => matchesSelectedNode(n, oc, ot));
      if (label) {
        applyLabelPosition(label, theta, cx, cy, labelRadius);
        label.setAttribute("data-label-theta", String(theta));
      }

      const bubbleNode = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle.bubble, circle.trend-bubble, circle[data-trend]"),
      ).find((n) => matchesSelectedNode(n, oc, ot));
      if (!bubbleNode) continue;

      const bx = Number.parseFloat(bubbleNode.getAttribute("cx") ?? "");
      const by = Number.parseFloat(bubbleNode.getAttribute("cy") ?? "");
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;

      const connector = Array.from(
        svg.querySelectorAll<SVGElement>("#radar-connectors path, #radar-connectors line, #radar-connectors polyline"),
      ).find((node) => {
        const sp = getConnectorStartPoint(node);
        return sp && Math.abs(sp.x - bx) <= 0.75 && Math.abs(sp.y - by) <= 0.75;
      });
      if (!connector) continue;

      const vx = Math.cos(theta);
      const vy = Math.sin(theta);
      const p3x = cx + R_tealOuter * vx;
      const p3y = cy + R_tealOuter * vy;
      const distance = Math.hypot(p3x - bx, p3y - by);
      const c1 = Math.max(30, Math.min(160, distance * 0.22));
      const c2 = Math.max(40, Math.min(190, distance * 0.32));
      connector.setAttribute("d", `M ${bx} ${by} C ${bx + vx * c1} ${by + vy * c1} ${p3x - vx * c2} ${p3y - vy * c2} ${p3x} ${p3y}`);
    }
  }, [svgMarkup]);

  // ── Compute slots when a bubble is selected ──
  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector("svg");
    if (!svg || !selectedBubbleKey) {
      setSlots([]);
      return;
    }

    const { clusterId, trend } = parseSelectedBubbleKey(selectedBubbleKey);
    const newSlots = computeSlots(svg, clusterId, trend);
    setSlots(newSlots);
  }, [selectedBubbleKey, svgMarkup]);

  // ── Render slot circles into the SVG DOM ──
  const selectedBubbleKeyRef = useRef(selectedBubbleKey);
  selectedBubbleKeyRef.current = selectedBubbleKey;

  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector("svg");
    if (!svg) return;

    svg.querySelector("#radar-slots")?.remove();

    if (slots.length === 0) return;

    // Determine hover color from selected bubble's type
    const { clusterId, trend } = parseSelectedBubbleKey(selectedBubbleKeyRef.current);
    const bubbleNodes = Array.from(
      svg.querySelectorAll<SVGElement>("circle.bubble, circle.trend-bubble, circle[data-trend], image.bubble"),
    );
    const bubbleNode = bubbleNodes.find((n) => matchesSelectedNode(n, clusterId, trend));
    const bubbleType = bubbleNode?.getAttribute("data-bubble-type") ?? "";
    const hoverColor = CONNECTOR_COLORS[bubbleType] ?? "#77acff";

    const slotsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    slotsGroup.id = "radar-slots";
    slotsGroup.style.pointerEvents = "auto";

    // Insert after #radar-labels-outer for correct z-order
    const labelsGroup = svg.querySelector("#radar-labels-outer");
    if (labelsGroup?.nextSibling) {
      svg.insertBefore(slotsGroup, labelsGroup.nextSibling);
    } else {
      svg.appendChild(slotsGroup);
    }

    slots.forEach((slot, i) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(slot.x));
      circle.setAttribute("cy", String(slot.y));
      circle.setAttribute("r", "10");
      circle.setAttribute("fill", "#e0e0e0");
      circle.setAttribute("stroke", "none");
      circle.setAttribute("cursor", "pointer");
      circle.dataset.slotIndex = String(i);

      circle.addEventListener("mouseenter", () => {
        circle.setAttribute("fill", hoverColor);
      });
      circle.addEventListener("mouseleave", () => {
        circle.setAttribute("fill", "#e0e0e0");
      });

      slotsGroup.appendChild(circle);
    });

    return () => {
      svg.querySelector("#radar-slots")?.remove();
    };
  }, [slots]);

  // ── Apply label + connector overrides set by slot clicks ──
  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector("svg");
    if (!svg || Object.keys(labelOverrides).length === 0) return;

    const { R_tealOuter } = readSvgRadii(svg);
    const { cx, cy } = readSvgCenter(svg);
    const labelRadius = R_tealOuter + LABEL_OFFSET;

    for (const [key, theta] of Object.entries(labelOverrides)) {
      const { clusterId, trend } = parseSelectedBubbleKey(key);

      const labelNodes = Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text"));
      const label = labelNodes.find((n) => matchesSelectedNode(n, clusterId, trend));
      if (label) {
        applyLabelPosition(label, theta, cx, cy, labelRadius);
        label.setAttribute("data-label-theta", String(theta));
      }

      const bubbleNode = Array.from(
        svg.querySelectorAll<SVGCircleElement>("circle.bubble, circle.trend-bubble, circle[data-trend]"),
      ).find((n) => matchesSelectedNode(n, clusterId, trend));
      if (!bubbleNode) continue;

      const bx = Number.parseFloat(bubbleNode.getAttribute("cx") ?? "");
      const by = Number.parseFloat(bubbleNode.getAttribute("cy") ?? "");
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;

      const connectorNodes = Array.from(
        svg.querySelectorAll<SVGElement>("#radar-connectors path, #radar-connectors line, #radar-connectors polyline"),
      );
      const connector = connectorNodes.find((node) => {
        const startPoint = getConnectorStartPoint(node);
        if (!startPoint) return false;
        return Math.abs(startPoint.x - bx) <= 0.75 && Math.abs(startPoint.y - by) <= 0.75;
      });
      if (!connector) continue;

      const vx = Math.cos(theta);
      const vy = Math.sin(theta);
      const p3x = cx + R_tealOuter * vx;
      const p3y = cy + R_tealOuter * vy;
      const distance = Math.hypot(p3x - bx, p3y - by);
      const c1 = Math.max(30, Math.min(160, distance * 0.22));
      const c2 = Math.max(40, Math.min(190, distance * 0.32));
      const p1x = bx + vx * c1;
      const p1y = by + vy * c1;
      const p2x = p3x - vx * c2;
      const p2y = p3y - vy * c2;
      connector.setAttribute("d", `M ${bx} ${by} C ${p1x} ${p1y} ${p2x} ${p2y} ${p3x} ${p3y}`);
    }
  }, [labelOverrides, svgMarkup]);

  const handleSlotClick = useCallback(
    (slotIndex: number) => {
      if (!selectedBubbleKey) return;
      const slot = slots[slotIndex];
      if (!slot) return;

      setLabelOverrides((prev) => ({ ...prev, [selectedBubbleKey]: slot.angle }));
      setSlots([]);
      onBubbleSelect(null);
    },
    [slots, selectedBubbleKey, onBubbleSelect],
  );

  function applySelectionHighlight(svg: Element, selectedClusterId: string | null, selectedTrend: string | null) {
    appliedSelectionRef.current = { clusterId: selectedClusterId, trend: selectedTrend };

    svg.querySelector("#radar-selection-highlight")?.remove();
    svg.querySelectorAll(".is-selected-bubble").forEach((node) => node.classList.remove("is-selected-bubble"));
    svg.querySelectorAll(".is-selected-label").forEach((node) => node.classList.remove("is-selected-label"));
    svg.querySelectorAll(".is-selected-connector").forEach((node) => node.classList.remove("is-selected-connector"));

    if (!selectedClusterId && !selectedTrend) return;

    const bubbleNodes = Array.from(svg.querySelectorAll<SVGElement>("circle.bubble, circle.trend-bubble, circle[data-trend], image.bubble, image.trend-bubble"));
    const labelNodes = Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text"));
    const connectorNodes = Array.from(
      svg.querySelectorAll<SVGElement>("#radar-connectors path, #radar-connectors line, #radar-connectors polyline"),
    );

    bubbleNodes
      .filter((node) => matchesSelectedNode(node, selectedClusterId, selectedTrend))
      .forEach((node) => node.classList.add("is-selected-bubble"));

    labelNodes
      .filter((node) => matchesSelectedNode(node, selectedClusterId, selectedTrend))
      .forEach((node) => node.classList.add("is-selected-label"));

    const selectedBubbleCircle = Array.from(
      svg.querySelectorAll<SVGCircleElement>("circle.bubble, circle.trend-bubble, circle[data-trend]"),
    ).find((node) => matchesSelectedNode(node, selectedClusterId, selectedTrend));

    const cx = Number.parseFloat(selectedBubbleCircle?.getAttribute("cx") ?? "");
    const cy = Number.parseFloat(selectedBubbleCircle?.getAttribute("cy") ?? "");
    const br = Number.parseFloat(selectedBubbleCircle?.getAttribute("r") ?? "");

    if (selectedBubbleCircle && Number.isFinite(cx) && Number.isFinite(cy) && br > 0) {
      const highlightG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      highlightG.id = "radar-selection-highlight";
      highlightG.style.pointerEvents = "none";
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("cx", String(cx));
      ring.setAttribute("cy", String(cy));
      ring.setAttribute("r", String(br));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "#77acff");
      ring.setAttribute("stroke-width", "2");
      highlightG.appendChild(ring);
      const bubblesGroup = svg.querySelector("#radar-bubbles");
      svg.insertBefore(highlightG, bubblesGroup?.nextSibling ?? null);
    }

    const connectorsByAttribute = connectorNodes.filter((node) =>
      matchesSelectedNode(node, selectedClusterId, selectedTrend),
    );
    if (connectorsByAttribute.length > 0) {
      connectorsByAttribute.forEach((node) => node.classList.add("is-selected-connector"));
      return;
    }

    if (!selectedBubbleCircle || !Number.isFinite(cx) || !Number.isFinite(cy)) return;

    connectorNodes.forEach((node) => {
      const startPoint = getConnectorStartPoint(node);
      if (!startPoint) return;

      if (Math.abs(startPoint.x - cx) <= 0.75 && Math.abs(startPoint.y - cy) <= 0.75) {
        node.classList.add("is-selected-connector");
      }
    });
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }

    const target = event.target as Element | null;

    // Check if a slot was clicked
    const slotCircle = target?.closest("#radar-slots circle") as SVGCircleElement | null;
    if (slotCircle) {
      const index = Number.parseInt(slotCircle.dataset.slotIndex ?? "", 10);
      if (Number.isFinite(index)) {
        handleSlotClick(index);
        return;
      }
    }

    const selectableNode = getSelectableNode(target);
    if (!selectableNode) {
      onBubbleSelect(null);
      setSlots([]);
      // Clear highlight immediately via DOM
      const svg = previewSvgRef.current?.querySelector("svg");
      if (svg) applySelectionHighlight(svg, null, null);
      return;
    }

    const clusterId = normalizeSvgValue(selectableNode.getAttribute("data-cluster-id"));
    const trend = normalizeSvgValue(selectableNode.getAttribute("data-trend"));
    const newKey = toBubbleSelectionKey(clusterId, trend);
    const svg = previewSvgRef.current?.querySelector("svg");

    // Toggle: clicking the same bubble again deselects
    if (newKey === selectedBubbleKey) {
      onBubbleSelect(null);
      setSlots([]);
      if (svg) applySelectionHighlight(svg, null, null);
      return;
    }

    onBubbleSelect(newKey);
    if (svg) applySelectionHighlight(svg, clusterId, trend);
  }

  function handleZoomIn() {
    setZoom((current) => clamp(Number((current + 0.1).toFixed(2)), 0.6, 2.2));
  }

  function handleZoomOut() {
    setZoom((current) => clamp(Number((current - 0.1).toFixed(2)), 0.6, 2.2));
  }

  function handleZoomReset() {
    setZoom(1);
    setTranslateX(0);
    setTranslateY(0);
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    const selectableNode = getSelectableNode(target);
    const slotNode = target?.closest("#radar-slots circle");
    if (selectableNode || slotNode) {
      return;
    }

    suppressClickRef.current = false;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      tx: translateX,
      ty: translateY,
    };
    isDraggingRef.current = false;
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const dragStart = dragStartRef.current;
    if (!dragStart) return;

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (!isDraggingRef.current) {
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }

      isDraggingRef.current = true;
      setIsDragging(true);
      suppressClickRef.current = true;
    }

    event.preventDefault();
    setTranslateX(dragStart.tx + deltaX);
    setTranslateY(dragStart.ty + deltaY);
  }

  function endDragging(event?: React.MouseEvent<HTMLDivElement>) {
    if (isDraggingRef.current) {
      event?.preventDefault();
    }

    dragStartRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
  }

  return (
    <section
      data-selected-bubble-key={selectedBubbleKey ?? undefined}
      className={`relative min-w-0 overflow-hidden bg-white shadow-[0_6px_18px_rgba(0,0,0,0.03)] ${
        sidebarOpen ? "rounded-[16px] xl:rounded-r-none" : "rounded-[16px]"
      }`}
    >
      {!sidebarOpen && (
        <div className="absolute right-6 top-6 z-10">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex items-center justify-center rounded-full border border-[rgba(34,34,34,0.2)] bg-white px-4 py-3 text-[12px] text-[#222222] transition hover:bg-[#f6f6f6]"
            style={displayFont}
          >
            Show panel
          </button>
        </div>
      )}

      <div
        className={`trend-radar-preview trend-preview-scroll min-h-[780px] overflow-hidden bg-white ${
          isDragging ? "is-dragging" : ""
        }`}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDragging}
        onMouseLeave={endDragging}
        onDragStart={(event) => event.preventDefault()}
      >
        <style>{`
          .trend-preview-scroll{
            overscroll-behavior: contain;
            width:100%;
            height:100%;
            position:relative;
            user-select:none;
            cursor:grab;
          }
          .trend-preview-scroll.is-dragging{
            cursor:grabbing;
          }
          .trend-preview-zoomShell{
            width:100%;
            min-height:780px;
            display:flex;
            align-items:flex-start;
            justify-content:center;
            overflow:hidden;
            padding:24px 32px 32px;
          }
          .trend-preview-zoom{
            display:inline-block;
            will-change:transform;
          }
          .trend-preview-svg{
            width:min(100%, 1000px);
            max-width:100%;
          }
          .trend-preview-svg svg{
            width:100%;
            max-width:100%;
            height:auto;
            display:block;
          }
          .trend-preview-svg svg circle.bubble,
          .trend-preview-svg svg circle.trend-bubble,
          .trend-preview-svg svg circle[data-trend],
          .trend-preview-svg svg image.bubble,
          .trend-preview-svg svg image.trend-bubble,
          .trend-preview-svg svg #radar-labels-outer text{
            cursor:pointer;
          }
          .trend-preview-svg svg circle.bubble,
          .trend-preview-svg svg circle.trend-bubble{
            transition:stroke 140ms ease, stroke-width 140ms ease, filter 140ms ease;
          }
          .trend-preview-svg svg image.bubble,
          .trend-preview-svg svg image.trend-bubble{
            transition:filter 140ms ease;
          }
          .trend-preview-svg svg #radar-labels-outer text{
            transition:fill 140ms ease, opacity 140ms ease;
          }
          .trend-preview-svg svg circle.bubble.is-selected-bubble,
          .trend-preview-svg svg circle.trend-bubble.is-selected-bubble{
            stroke:#77acff;
            stroke-width:4;
            stroke-opacity:0.92;
            filter:drop-shadow(0 0 8px rgba(119,172,255,0.35));
          }
          .trend-preview-svg svg image.bubble.is-selected-bubble,
          .trend-preview-svg svg image.trend-bubble.is-selected-bubble{
            filter:drop-shadow(0 0 6px rgba(119,172,255,0.44)) drop-shadow(0 0 14px rgba(119,172,255,0.24));
          }
          .trend-preview-svg svg #radar-connectors path.is-selected-connector,
          .trend-preview-svg svg #radar-connectors line.is-selected-connector,
          .trend-preview-svg svg #radar-connectors polyline.is-selected-connector{
            stroke:#77acff !important;
            stroke-width:1.5 !important;
            opacity:1;
          }
          .trend-preview-svg svg #radar-labels-outer text.is-selected-label{
            fill:#1f2f52;
            font-weight:700;
            opacity:1;
          }
          .trend-preview-zoomControls{
            position:absolute;
            right:18px;
            top:50%;
            transform:translateY(-50%);
            display:flex;
            flex-direction:column;
            gap:4px;
            z-index:5;
          }
          .trend-preview-zoomControls button{
            width:40px;
            height:40px;
            border-radius:999px;
            background:#fff;
            border:1px solid rgba(34,34,34,0.2);
            box-shadow:2px 2px 4px rgba(0,0,0,0.1);
            display:flex;
            align-items:center;
            justify-content:center;
            cursor:pointer;
          }
          .trend-preview-zoomControls button:active{
            transform:scale(0.98);
          }
          .trend-preview-zoomControls img{
            display:block;
          }
        `}</style>

        {svgMarkup ? (
          <>
            <div className="trend-preview-zoomControls">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleZoomIn();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                aria-label="Zoom in"
              >
                <Image src="/zoom-plus.svg" alt="" width={20} height={20} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleZoomOut();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                aria-label="Zoom out"
              >
                <Image src="/zoom-minus.svg" alt="" width={20} height={20} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleZoomReset();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                aria-label="Reset zoom"
              >
                <span className="text-[18px] leading-none text-[#222222]">↺</span>
              </button>
            </div>

            <div className="trend-preview-zoomShell">
              <div
                className="trend-preview-zoom"
                style={{
                  transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
                  transformOrigin: "top center",
                }}
              >
                <div
                  ref={svgContainerRef}
                  className="trend-preview-svg"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-[780px] items-center justify-center px-8 text-center text-sm leading-6 text-[#7b7b7b]">
            Upload a trend radar HTML file to render the styled SVG preview.
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="border-t border-[rgba(34,34,34,0.08)] bg-[#fff7e9] px-5 py-4 text-sm text-[#77591c]">
          <div className="font-semibold text-[#5c4413]" style={displayFont}>
            Warnings
          </div>
          <ul className="mt-2 list-disc pl-5">
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
