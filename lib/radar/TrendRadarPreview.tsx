"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGapBasedSlots,
  classifyRadarLabelSideFromTheta,
  estimateLabelWidth,
  findNearestRadarLabelSlot,
  readRadarGeometryFromSvg,
  type LabelBBox,
  type RadarLabelSide,
  type RadarLabelSlot,
  type RadarRenderedLabel,
  type RadarTextAnchor,
} from "@/lib/radar/radarLabelSlots";

export type SelectedRadarLabelPayload = {
  clusterId: string;
  trend: string | null;
  x: number;
  y: number;
  theta: number;
  textAnchor: RadarTextAnchor;
  text: string;
  preferredSide: RadarLabelSide;
};

export type PreviewSlotOverlayEntry = {
  slot: RadarLabelSlot;
  source: "primary" | "extra";
  state: "current" | "occupied" | "available";
  occupiedByClusterId: string | null;
};

type SelectedLabelPreview = {
  bubbleAnchor: { x: number; y: number } | null;
  text: string;
  fontFamily: string;
  fontSize: string;
  connectorStroke: string;
};

type TrendRadarPreviewProps = {
  assignedPreviewSlots: Array<{
    selectionKey: string;
    label: RadarRenderedLabel;
    slot: RadarLabelSlot;
  }>;
  hasPendingSlotEdits: boolean;
  onAssignSlotToSelectedLabel: (slotId: string) => void;
  onSaveSlotEdits: () => void;
  onSelectResolvedLabel: (label: SelectedRadarLabelPayload | null) => void;
  onToggleSlotOverlay: () => void;
  onToggleSidebar: () => void;
  selectedBubbleKey: string | null;
  selectedLabelPreview: SelectedLabelPreview | null;
  selectedSlotKey: string | null;
  sidebarOpen: boolean;
  slotOverlayVisible: boolean;
  slotOverlayEntries: PreviewSlotOverlayEntry[];
  svgMarkup: string;
  warnings: string[];
};

function normalizeSvgValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getSelectableNode(target: Element | null) {
  return target?.closest("circle.bubble, image.bubble, #radar-labels-outer text") ?? null;
}

function isSlotOverlayTarget(target: Element | null) {
  return Boolean(target?.closest('[data-slot-overlay-entry="true"]'));
}

/**
 * Get a stable selection key from any SVG node (bubble or label).
 * Prefers data-cluster-id, falls back to data-trend, then data-tooltip.
 */
function getNodeSelectionKey(node: Element | null): string | null {
  if (!node) return null;
  return (
    normalizeSvgValue(node.getAttribute("data-cluster-id")) ??
    normalizeSvgValue(node.getAttribute("data-trend")) ??
    normalizeSvgValue(node.getAttribute("data-tooltip")) ??
    null
  );
}

/**
 * Find the outer label text node that matches a given selection key.
 * Searches by data-cluster-id first, then data-trend.
 */
function findOuterLabelNode(svg: SVGSVGElement | null, selectionKey: string | null): SVGTextElement | null {
  if (!svg || !selectionKey) return null;

  const escaped = escapeAttributeValue(selectionKey);

  // Try data-cluster-id first
  const byClusterId = svg.querySelector<SVGTextElement>(
    `#radar-labels-outer text[data-cluster-id="${escaped}"]`,
  );
  if (byClusterId) return byClusterId;

  // Fall back to data-trend
  const byTrend = svg.querySelector<SVGTextElement>(
    `#radar-labels-outer text[data-trend="${escaped}"]`,
  );
  if (byTrend) return byTrend;

  return null;
}

// Keep old name for compatibility but delegate
function findOuterLabelNodeByClusterId(svg: SVGSVGElement | null, clusterId: string | null) {
  return findOuterLabelNode(svg, clusterId);
}

function clientToSvgPoint(clientX: number, clientY: number, svg: SVGSVGElement): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  return {
    x: inv.a * clientX + inv.c * clientY + inv.e,
    y: inv.b * clientX + inv.d * clientY + inv.f,
  };
}

/** Get the bounding box of an SVG element in root SVG coordinate space (handles rotated text). */
function getSvgRootBBox(element: SVGGraphicsElement): LabelBBox | null {
  const clusterId =
    element.getAttribute("data-cluster-id") ??
    element.getAttribute("data-trend") ??
    element.getAttribute("data-tooltip");
  if (!clusterId) return null;

  try {
    const bbox = element.getBBox();
    const ctm = element.getCTM();
    if (!ctm || bbox.width === 0) return null;

    const corners = [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x, y: bbox.y + bbox.height },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    ];

    const transformed = corners.map((c) => ({
      x: ctm.a * c.x + ctm.c * c.y + ctm.e,
      y: ctm.b * c.x + ctm.d * c.y + ctm.f,
    }));

    const xs = transformed.map((t) => t.x);
    const ys = transformed.map((t) => t.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    return {
      clusterId,
      x: minX,
      y: minY,
      width: Math.max(...xs) - minX,
      height: Math.max(...ys) - minY,
    };
  } catch {
    return null;
  }
}

function normalizeTextAnchor(value: string | null | undefined): RadarTextAnchor {
  const normalized = normalizeSvgValue(value);
  return normalized === "start" || normalized === "middle" || normalized === "end" ? normalized : "start";
}

function deriveLabelTheta(svg: SVGSVGElement, x: number, y: number) {
  const centerX = toFiniteNumber(svg.getAttribute("data-radar-center-x"));
  const centerY = toFiniteNumber(svg.getAttribute("data-radar-center-y"));
  if (centerX == null || centerY == null) return null;

  return Math.atan2(y - centerY, x - centerX);
}

function buildSelectedLabelPayload(svg: SVGSVGElement, matchedLabel: SVGTextElement): SelectedRadarLabelPayload | null {
  // Use the best available key: data-cluster-id → data-trend → data-tooltip
  const clusterId = getNodeSelectionKey(matchedLabel);
  const x = toFiniteNumber(matchedLabel.getAttribute("x"));
  const y = toFiniteNumber(matchedLabel.getAttribute("y"));
  const theta =
    toFiniteNumber(matchedLabel.getAttribute("data-label-theta")) ??
    (x != null && y != null ? deriveLabelTheta(svg, x, y) : null);

  if (!clusterId || x == null || y == null || theta == null) {
    return null;
  }

  return {
    clusterId,
    trend: normalizeSvgValue(matchedLabel.getAttribute("data-trend")),
    x,
    y,
    theta,
    textAnchor: normalizeTextAnchor(matchedLabel.getAttribute("text-anchor")),
    text: normalizeSvgValue(matchedLabel.textContent) ?? "",
    preferredSide: classifyRadarLabelSideFromTheta(theta),
  };
}

function matchesSelectedNode(node: Element, selectedKey: string | null) {
  if (!selectedKey) return false;

  // Match against any of the three possible selection attributes
  const clusterId = normalizeSvgValue(node.getAttribute("data-cluster-id"));
  if (clusterId === selectedKey) return true;

  const trend = normalizeSvgValue(node.getAttribute("data-trend"));
  if (trend === selectedKey) return true;

  const tooltip = normalizeSvgValue(node.getAttribute("data-tooltip"));
  if (tooltip === selectedKey) return true;

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

function toFiniteNumber(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getOverlayViewBox(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox")?.trim();
  if (viewBox) return viewBox;

  const width = toFiniteNumber(svg.getAttribute("width"));
  const height = toFiniteNumber(svg.getAttribute("height"));
  if (width == null || height == null) return null;

  return `0 0 ${width} ${height}`;
}

function escapeCssAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildOriginalHideRules(
  assignedPreviewSlots: TrendRadarPreviewProps["assignedPreviewSlots"],
) {
  return assignedPreviewSlots
    .map(({ label }) => {
      const rules: string[] = [];

      // Hide by all possible attributes to ensure the original label is hidden
      if (label.clusterId) {
        const escapedCid = escapeCssAttributeValue(label.clusterId);
        rules.push(
          `.trend-preview-svgMarkup svg #radar-labels-outer text[data-cluster-id="${escapedCid}"]{opacity:0 !important;}`,
        );
        // Also try data-trend with the same value (key may have come from data-trend/data-tooltip)
        rules.push(
          `.trend-preview-svgMarkup svg #radar-labels-outer text[data-trend="${escapedCid}"]{opacity:0 !important;}`,
        );
      }
      if (label.trend && label.trend !== label.clusterId) {
        rules.push(
          `.trend-preview-svgMarkup svg #radar-labels-outer text[data-trend="${escapeCssAttributeValue(label.trend)}"]{opacity:0 !important;}`,
        );
      }

      if (label.connector?.pathData) {
        rules.push(
          `.trend-preview-svgMarkup svg #radar-connectors path[d="${escapeCssAttributeValue(label.connector.pathData)}"]{opacity:0 !important;}`,
        );
      }

      return rules.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function buildAssignedConnectorPath(
  bubbleAnchor: { x: number; y: number },
  connectorAnchor: { x: number; y: number },
) {
  const dx = connectorAnchor.x - bubbleAnchor.x;
  const dy = connectorAnchor.y - bubbleAnchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) {
    return `M ${bubbleAnchor.x} ${bubbleAnchor.y}`;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const control1Distance = Math.max(26, Math.min(120, distance * 0.28));
  const control2Distance = Math.max(18, Math.min(90, distance * 0.16));

  return [
    `M ${bubbleAnchor.x} ${bubbleAnchor.y}`,
    `C ${bubbleAnchor.x + nx * control1Distance} ${bubbleAnchor.y + ny * control1Distance}`,
    `${connectorAnchor.x - nx * control2Distance} ${connectorAnchor.y - ny * control2Distance}`,
    `${connectorAnchor.x} ${connectorAnchor.y}`,
  ].join(" ");
}

export function TrendRadarPreview({
  assignedPreviewSlots,
  hasPendingSlotEdits,
  onAssignSlotToSelectedLabel,
  onSaveSlotEdits,
  onSelectResolvedLabel,
  onToggleSlotOverlay,
  onToggleSidebar,
  selectedBubbleKey,
  selectedLabelPreview,
  selectedSlotKey,
  sidebarOpen,
  slotOverlayVisible,
  slotOverlayEntries,
  svgMarkup,
  warnings,
}: TrendRadarPreviewProps) {
  const DRAG_THRESHOLD_PX = 4;
  const [zoom, setZoom] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [overlayViewBox, setOverlayViewBox] = useState<string | null>(null);
  const [labelDragState, setLabelDragState] = useState<{
    nearestSlotId: string | null;
    mouseSvgPoint: { x: number; y: number } | null;
  } | null>(null);
  const [hoveredBubble, setHoveredBubble] = useState<{ label: string; x: number; y: number } | null>(null);
  const [bboxArcSlots, setBboxArcSlots] = useState<RadarLabelSlot[]>([]);

  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const previewSvgRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const labelDragRef = useRef<{
    clusterId: string;
    startClientX: number;
    startClientY: number;
    isDragging: boolean;
    nearestSlotId: string | null;
  } | null>(null);

  const displayFont = { fontFamily: "Montserrat, Open Sans, Arial, sans-serif" } as const;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const originalHideRules = buildOriginalHideRules(assignedPreviewSlots);
  const slotInspectorDisabled = !selectedSlotKey;

  // Combine workspace "current" slot entries with locally-computed getBBox-filtered arc candidates
  const effectiveSlotEntries = useMemo<PreviewSlotOverlayEntry[]>(() => {
    const currentEntries = slotOverlayEntries.filter((e) => e.state === "current");
    const availableEntries: PreviewSlotOverlayEntry[] = bboxArcSlots.map((slot) => ({
      slot,
      source: "extra" as const,
      state: "available" as const,
      occupiedByClusterId: null,
    }));
    return [...currentEntries, ...availableEntries];
  }, [slotOverlayEntries, bboxArcSlots]);

  const hasSlotOverlayContent =
    assignedPreviewSlots.length > 0 ||
    (slotOverlayVisible && effectiveSlotEntries.length > 0) ||
    hoveredBubble != null;
  const isLabelDragging = labelDragState != null && labelDragRef.current?.isDragging === true;
  const dragPreviewSlotEntry = labelDragState?.nearestSlotId
    ? effectiveSlotEntries.find((e) => e.slot.id === labelDragState.nearestSlotId) ?? null
    : null;

  // Clear drag state when selection changes — but preserve if a drag is already in progress
  useEffect(() => {
    if (labelDragRef.current) return;
    setLabelDragState(null);
  }, [selectedBubbleKey]);



  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setZoom(1);
      setTranslateX(0);
      setTranslateY(0);
      setIsDragging(false);
      dragStartRef.current = null;
      isDraggingRef.current = false;
      suppressClickRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [svgMarkup]);

  useEffect(() => {
    const root = previewSvgRef.current;
    if (!root) return;

    const timeoutId = window.setTimeout(() => {
      const svg = root.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg");
      if (!svg) {
        setOverlayViewBox(null);
        return;
      }

      setOverlayViewBox(getOverlayViewBox(svg));
      svg.querySelectorAll("text").forEach((node) => {
        const t = node.textContent?.trim();
        if (["P", "W", "G", "L"].includes(t || "")) {
          node.remove();
        }
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [svgMarkup]);

  // Compute gap-based candidate slots using actual getBBox() on rendered label elements
  useEffect(() => {
    const root = previewSvgRef.current;
    if (!root || !selectedBubbleKey) {
      setBboxArcSlots([]);
      return;
    }

    const svg = root.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg");
    if (!svg) {
      setBboxArcSlots([]);
      return;
    }

    const geometry = readRadarGeometryFromSvg(svg);
    if (!geometry) {
      setBboxArcSlots([]);
      return;
    }

    // Collect bounding boxes from all label text elements (support data-cluster-id OR data-trend)
    const labelNodes = svg.querySelectorAll<SVGTextElement>(
      "#radar-labels-outer text[data-cluster-id], #radar-labels-outer text[data-trend]",
    );
    const bboxes: LabelBBox[] = [];
    const seenIds = new Set<string>();
    labelNodes.forEach((node) => {
      const bbox = getSvgRootBBox(node);
      if (bbox && !seenIds.has(bbox.clusterId)) {
        seenIds.add(bbox.clusterId);
        bboxes.push(bbox);
      }
    });

    // Find the selected bubble's position to compute its angle from center
    const escapedKey = selectedBubbleKey.replace(/["\\]/g, "\\$&");
    // Try data-cluster-id, then data-trend, then data-tooltip for bubble lookup
    const bubbleNode =
      svg.querySelector<SVGElement>(
        `circle.bubble[data-cluster-id="${escapedKey}"], image.bubble[data-cluster-id="${escapedKey}"]`,
      ) ??
      svg.querySelector<SVGElement>(
        `circle.bubble[data-trend="${escapedKey}"], image.bubble[data-trend="${escapedKey}"]`,
      ) ??
      svg.querySelector<SVGElement>(
        `circle.bubble[data-tooltip="${escapedKey}"], image.bubble[data-tooltip="${escapedKey}"]`,
      );
    let bubbleTheta = 0;
    if (bubbleNode) {
      let bx: number | null = null;
      let by: number | null = null;
      if (bubbleNode.tagName === "circle") {
        bx = toFiniteNumber(bubbleNode.getAttribute("cx"));
        by = toFiniteNumber(bubbleNode.getAttribute("cy"));
      } else {
        const ix = toFiniteNumber(bubbleNode.getAttribute("x"));
        const iy = toFiniteNumber(bubbleNode.getAttribute("y"));
        const iw = toFiniteNumber(bubbleNode.getAttribute("width"));
        const ih = toFiniteNumber(bubbleNode.getAttribute("height"));
        if (ix != null && iy != null && iw != null && ih != null) {
          bx = ix + iw / 2;
          by = iy + ih / 2;
        }
      }
      if (bx != null && by != null) {
        bubbleTheta = Math.atan2(by - geometry.center.y, bx - geometry.center.x);
      }
    } else {
      // Fallback: use the label's position if bubble DOM not found
      const selectedLabelNode = findOuterLabelNode(svg, selectedBubbleKey);
      if (selectedLabelNode) {
        const lx = toFiniteNumber(selectedLabelNode.getAttribute("x"));
        const ly = toFiniteNumber(selectedLabelNode.getAttribute("y"));
        if (lx != null && ly != null) {
          bubbleTheta = Math.atan2(ly - geometry.center.y, lx - geometry.center.x);
        }
      }
    }

    const slots = buildGapBasedSlots({
      geometry,
      labelBBoxes: bboxes,
      selectedClusterId: selectedBubbleKey,
      bubbleTheta,
    });

    setBboxArcSlots(slots);
  }, [selectedBubbleKey, svgMarkup]);

  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg");
    if (!svg) return;

    svg.querySelectorAll(".is-selected-bubble").forEach((node) => node.classList.remove("is-selected-bubble"));
    svg.querySelectorAll(".is-selected-label").forEach((node) => node.classList.remove("is-selected-label"));
    svg.querySelectorAll(".is-selected-connector").forEach((node) => node.classList.remove("is-selected-connector"));

    const selectedClusterId = normalizeSvgValue(selectedBubbleKey);
    if (!selectedClusterId) return;

    const bubbleNodes = Array.from(svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble"));
    const labelNodes = Array.from(svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text"));
    const connectorNodes = Array.from(
      svg.querySelectorAll<SVGElement>("#radar-connectors path, #radar-connectors line, #radar-connectors polyline"),
    );

    bubbleNodes
      .filter((node) => matchesSelectedNode(node, selectedClusterId))
      .forEach((node) => node.classList.add("is-selected-bubble"));

    labelNodes
      .filter((node) => matchesSelectedNode(node, selectedClusterId))
      .forEach((node) => node.classList.add("is-selected-label"));

    const connectorsByAttribute = connectorNodes.filter((node) => matchesSelectedNode(node, selectedClusterId));
    if (connectorsByAttribute.length > 0) {
      connectorsByAttribute.forEach((node) => node.classList.add("is-selected-connector"));
      return;
    }

    const selectedBubbleCircle = Array.from(svg.querySelectorAll<SVGCircleElement>("circle.bubble")).find((node) =>
      matchesSelectedNode(node, selectedClusterId),
    );
    if (!selectedBubbleCircle) return;

    const cx = Number.parseFloat(selectedBubbleCircle.getAttribute("cx") ?? "");
    const cy = Number.parseFloat(selectedBubbleCircle.getAttribute("cy") ?? "");
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    // Current connector paths do not carry bubble identity, so match them by the bubble start point.
    connectorNodes.forEach((node) => {
      const startPoint = getConnectorStartPoint(node);
      if (!startPoint) return;

      if (Math.abs(startPoint.x - cx) <= 0.75 && Math.abs(startPoint.y - cy) <= 0.75) {
        node.classList.add("is-selected-connector");
      }
    });
  }, [selectedBubbleKey, svgMarkup]);

  // Bubble hover tooltips — attach DOM listeners to bubbles in the base SVG
  useEffect(() => {
    const root = previewSvgRef.current;
    if (!root) return;

    const svg = root.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg");
    if (!svg) return;

    const bubbles = svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble");

    function handleBubbleEnter(event: Event) {
      const target = event.currentTarget as SVGElement;
      const tooltip = normalizeSvgValue(target.getAttribute("data-tooltip"));
      const trend = normalizeSvgValue(target.getAttribute("data-trend"));
      const clusterId = normalizeSvgValue(target.getAttribute("data-cluster-id"));
      const bubbleKey = clusterId ?? trend ?? tooltip;

      const labelNode = bubbleKey ? findOuterLabelNode(svg!, bubbleKey) : null;
      const labelText = labelNode?.textContent?.trim() || trend || tooltip || clusterId || "";

      let cx: number;
      let cy: number;
      if (target.tagName === "circle") {
        cx = Number.parseFloat(target.getAttribute("cx") ?? "0");
        cy = Number.parseFloat(target.getAttribute("cy") ?? "0");
      } else {
        const x = Number.parseFloat(target.getAttribute("x") ?? "0");
        const y = Number.parseFloat(target.getAttribute("y") ?? "0");
        const w = Number.parseFloat(target.getAttribute("width") ?? "0");
        const h = Number.parseFloat(target.getAttribute("height") ?? "0");
        cx = x + w / 2;
        cy = y + h / 2;
      }

      setHoveredBubble({ label: labelText, x: cx, y: cy });
    }

    function handleBubbleLeave() {
      setHoveredBubble(null);
    }

    bubbles.forEach((b) => {
      b.addEventListener("mouseenter", handleBubbleEnter);
      b.addEventListener("mouseleave", handleBubbleLeave);
    });

    return () => {
      bubbles.forEach((b) => {
        b.removeEventListener("mouseenter", handleBubbleEnter);
        b.removeEventListener("mouseleave", handleBubbleLeave);
      });
    };
  }, [svgMarkup]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }

    const target = event.target as Element | null;
    if (isSlotOverlayTarget(target)) {
      return;
    }

    const selectableNode = getSelectableNode(target);
    if (!selectableNode) {
      // In slots mode, clicking empty space does NOT deselect — user stays in slots mode
      if (!slotOverlayVisible) {
        onSelectResolvedLabel(null);
      }
      return;
    }

    const bubble = selectableNode.matches("circle.bubble, image.bubble") ? selectableNode : null;
    const selectionKey = getNodeSelectionKey(selectableNode);
    const svg = previewSvgRef.current?.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg") ?? null;
    const matchedLabel =
      selectableNode.matches("#radar-labels-outer text")
        ? (selectableNode as SVGTextElement)
        : findOuterLabelNode(svg, selectionKey);

    console.debug("[slot-selection-debug]", {
      selectionKey,
      bubbleTrend: bubble?.getAttribute("data-trend"),
      bubbleTooltip: bubble?.getAttribute("data-tooltip"),
      labelLookupSucceeded: !!matchedLabel,
      matchedLabelText: matchedLabel?.textContent,
    });

    if (!selectionKey || !svg || !matchedLabel) {
      console.warn("Trend Radar slot debug: failed to resolve outer label for selected element.", {
        selectionKey,
      });
      onSelectResolvedLabel(null);
      return;
    }

    onSelectResolvedLabel(buildSelectedLabelPayload(svg, matchedLabel));
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

    if (isSlotOverlayTarget(event.target as Element | null)) {
      return;
    }

    const selectableNode = getSelectableNode(event.target as Element | null);
    if (selectableNode) {
      // Start label drag if mousedown is on a label text
      const isLabel = selectableNode.matches("#radar-labels-outer text");
      if (isLabel) {
        const labelKey = getNodeSelectionKey(selectableNode);
        if (labelKey) {
          const svg = previewSvgRef.current?.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg") ?? null;
          if (svg) {
            onSelectResolvedLabel(buildSelectedLabelPayload(svg, selectableNode as SVGTextElement));
          }
          labelDragRef.current = {
            clusterId: labelKey,
            startClientX: event.clientX,
            startClientY: event.clientY,
            isDragging: false,
            nearestSlotId: null,
          };
          event.preventDefault();
          return; // label drag initiated — don't set up pan
        }
      }
      // Bubble click: fall through to pan setup below (click handler handles selection on mouseup)
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
    // Label drag handling
    const labelDrag = labelDragRef.current;
    if (labelDrag) {
      const deltaX = event.clientX - labelDrag.startClientX;
      const deltaY = event.clientY - labelDrag.startClientY;
      const distance = Math.hypot(deltaX, deltaY);

      if (!labelDrag.isDragging) {
        if (distance < DRAG_THRESHOLD_PX) return;
        labelDrag.isDragging = true;
        suppressClickRef.current = true;
      }

      event.preventDefault();

      const overlaySvg = overlayRef.current;
      if (!overlaySvg) return;

      const svgPoint = clientToSvgPoint(event.clientX, event.clientY, overlaySvg);
      if (!svgPoint) return;

      const availableSlots = effectiveSlotEntries
        .filter((e) => e.state === "available")
        .map((e) => e.slot);
      const nearest = findNearestRadarLabelSlot(svgPoint, availableSlots);
      const nearestId = nearest?.id ?? null;
      labelDrag.nearestSlotId = nearestId;

      setLabelDragState({ nearestSlotId: nearestId, mouseSvgPoint: svgPoint });
      return;
    }

    // Canvas pan handling
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
    // Label drag end
    const labelDrag = labelDragRef.current;
    if (labelDrag) {
      if (labelDrag.isDragging && labelDrag.nearestSlotId) {
        onAssignSlotToSelectedLabel(labelDrag.nearestSlotId);
      }
      labelDragRef.current = null;
      setLabelDragState(null);
      if (labelDrag.isDragging) {
        event?.preventDefault();
      }
      return;
    }

    // Canvas pan end
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
        } ${isLabelDragging ? "is-label-dragging" : ""}`}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDragging}
        onMouseLeave={endDragging}
        onDragStart={(event) => event.preventDefault()}
      >
        {originalHideRules && <style>{originalHideRules}</style>}
        <style>{`
          .trend-preview-scroll{
            overscroll-behavior: contain;
            width:100%;
            height:100%;
            position:relative;
            user-select:none;
            cursor:grab;
          }
          .trend-preview-scroll.is-dragging,
          .trend-preview-scroll.is-label-dragging{
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
            position:relative;
          }
          .trend-preview-svgMarkup svg{
            width:100%;
            max-width:100%;
            height:auto;
            display:block;
          }
          .trend-preview-slotOverlay{
            position:absolute;
            inset:0;
            width:100%;
            height:100%;
            pointer-events:none;
            overflow:visible;
          }
          .trend-preview-svg svg circle.bubble,
          .trend-preview-svg svg image.bubble,
          .trend-preview-svg svg #radar-labels-outer text{
            cursor:grab;
          }
          .trend-preview-svg svg circle.bubble{
            transition:stroke 140ms ease, stroke-width 140ms ease, filter 140ms ease;
          }
          .trend-preview-svg svg image.bubble{
            transition:filter 140ms ease;
          }
          .trend-preview-svg svg #radar-labels-outer text{
            transition:fill 140ms ease, opacity 140ms ease;
          }
          @keyframes selectedBubblePulse{
            0%,100%{filter:drop-shadow(0 0 6px rgba(74,154,255,0.55))}
            50%{filter:drop-shadow(0 0 14px rgba(74,154,255,0.75))}
          }
          .trend-preview-svg svg circle.bubble.is-selected-bubble{
            stroke:#4a9aff !important;
            stroke-width:6 !important;
            stroke-opacity:0.95;
            filter:drop-shadow(0 0 10px rgba(74,154,255,0.55));
            animation:selectedBubblePulse 1.8s ease-in-out infinite;
          }
          .trend-preview-svg svg image.bubble.is-selected-bubble{
            filter:drop-shadow(0 0 8px rgba(74,154,255,0.55)) drop-shadow(0 0 16px rgba(74,154,255,0.3));
            animation:selectedBubblePulse 1.8s ease-in-out infinite;
          }
          .trend-preview-svg svg #radar-connectors path.is-selected-connector,
          .trend-preview-svg svg #radar-connectors line.is-selected-connector,
          .trend-preview-svg svg #radar-connectors polyline.is-selected-connector{
            stroke:#4a9aff !important;
            stroke-width:1.8 !important;
            opacity:1;
          }
          .trend-preview-svg svg #radar-labels-outer text.is-selected-label{
            fill:#1a3a6e;
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
          .trend-preview-slotToggle{
            position:absolute;
            left:18px;
            top:18px;
            z-index:5;
          }
          .trend-preview-slotToggle button{
            min-height:32px;
            border-radius:999px;
            border:1px solid rgba(34,34,34,0.14);
            background:rgba(255,255,255,0.92);
            padding:0 13px;
            font-size:11px;
            color:#888;
            box-shadow:1px 1px 3px rgba(0,0,0,0.06);
            transition:all 120ms ease;
          }
          .trend-preview-slotToggle button.is-active{
            background:rgba(255,255,255,0.98);
            border-color:rgba(119,172,255,0.4);
            color:#555;
          }
          .trend-preview-slotToggle button:disabled{
            opacity:0.45;
            cursor:not-allowed;
          }
          .trend-preview-slotToggle button.is-save{
            margin-left:6px;
            background:rgba(119,172,255,0.15);
            border-color:rgba(119,172,255,0.4);
            color:#3b7ddd;
            font-weight:600;
          }
          .trend-preview-slotToggle button.is-save:hover{
            background:rgba(119,172,255,0.28);
          }
        `}</style>

        {svgMarkup ? (
          <>
            {(selectedBubbleKey != null || assignedPreviewSlots.length > 0) && (
              <div className="trend-preview-slotToggle">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSlotOverlay();
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  disabled={slotInspectorDisabled}
                  className={slotOverlayVisible ? "is-active" : ""}
                  style={displayFont}
                >
                  {slotOverlayVisible ? "Hide Slots" : "Slots"}
                </button>
                {slotOverlayVisible && hasPendingSlotEdits && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSaveSlotEdits();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="is-save"
                    style={displayFont}
                  >
                    Save
                  </button>
                )}
              </div>
            )}

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
                  ref={previewSvgRef}
                  className="trend-preview-svg"
                >
                  <div className="trend-preview-svgMarkup" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
                  {overlayViewBox && hasSlotOverlayContent && (
                    <svg
                      ref={overlayRef}
                      className="trend-preview-slotOverlay"
                      viewBox={overlayViewBox}
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                    >
                      {assignedPreviewSlots.map(({ selectionKey, label, slot }) => {
                        const isSelectedOverride = selectionKey === selectedSlotKey;
                        const connectorPath =
                          label.bubbleAnchor == null
                            ? null
                            : buildAssignedConnectorPath(label.bubbleAnchor, slot.connectorAnchor);

                        // Compute rotation to follow the arc (like original labels)
                        const slotAngleDeg = (slot.angle * 180) / Math.PI;
                        const normalizedDeg = ((slotAngleDeg % 360) + 360) % 360;
                        const slotRotation = normalizedDeg > 90 && normalizedDeg < 270
                          ? slotAngleDeg + 180
                          : slotAngleDeg;

                        return (
                          <g key={`assigned-${selectionKey}`} opacity="0.98">
                            {connectorPath && (
                              <path
                                d={connectorPath}
                                stroke={isSelectedOverride ? "#4a9aff" : label.connector?.stroke ?? "#999"}
                                strokeWidth={isSelectedOverride ? "1.6" : label.connector?.strokeWidth ?? "0.55"}
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity={isSelectedOverride ? "1" : label.connector?.opacity ?? "0.9"}
                              />
                            )}
                            <text
                              x={slot.labelAnchor.x}
                              y={slot.labelAnchor.y}
                              textAnchor={slot.textAnchor}
                              dominantBaseline="middle"
                              fontFamily={label.fontFamily ?? "Open Sans, sans-serif"}
                              fontSize={label.fontSize ?? "12"}
                              fontWeight={isSelectedOverride ? "700" : label.fontWeight ?? "400"}
                              fill={isSelectedOverride ? "#1a3a6e" : label.fill ?? "#111"}
                              transform={`rotate(${slotRotation} ${slot.labelAnchor.x} ${slot.labelAnchor.y})`}
                              pointerEvents="auto"
                              style={{ cursor: "grab" }}
                              onMouseDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                const cId = normalizeSvgValue(label.clusterId);
                                if (!cId) return;
                                const svg = previewSvgRef.current?.querySelector<SVGSVGElement>(".trend-preview-svgMarkup svg") ?? null;
                                if (svg) {
                                  const matchedLabel = findOuterLabelNodeByClusterId(svg, cId);
                                  if (matchedLabel) {
                                    onSelectResolvedLabel(buildSelectedLabelPayload(svg, matchedLabel));
                                  }
                                }
                                labelDragRef.current = {
                                  clusterId: cId,
                                  startClientX: event.clientX,
                                  startClientY: event.clientY,
                                  isDragging: false,
                                  nearestSlotId: null,
                                };
                              }}
                            >
                              {label.text}
                            </text>
                          </g>
                        );
                      })}

                      {slotOverlayVisible && effectiveSlotEntries.length > 0 && (
                        <g pointerEvents="none">
                          {effectiveSlotEntries.map(({ slot, state }) => {
                            const isCurrentSlot = state === "current";
                            const isNearestDragTarget = labelDragState?.nearestSlotId === slot.id;

                            if (isCurrentSlot) {
                              return (
                                <g key={slot.id}>
                                  <circle
                                    cx={slot.labelAnchor.x}
                                    cy={slot.labelAnchor.y}
                                    r="10"
                                    fill="none"
                                    stroke="#77acff"
                                    strokeWidth="1.5"
                                    opacity="0.7"
                                  />
                                  <circle
                                    cx={slot.labelAnchor.x}
                                    cy={slot.labelAnchor.y}
                                    r="4"
                                    fill="#77acff"
                                    opacity="0.5"
                                  />
                                </g>
                              );
                            }

                            return (
                              <circle
                                key={slot.id}
                                cx={slot.labelAnchor.x}
                                cy={slot.labelAnchor.y}
                                r={isNearestDragTarget ? "13" : "10"}
                                fill={isNearestDragTarget ? "#77acff" : "#B0B0B0"}
                                opacity={isNearestDragTarget ? "1" : "0.7"}
                                style={{
                                  cursor: "pointer",
                                  pointerEvents: "auto",
                                  ...(isNearestDragTarget ? { filter: "drop-shadow(0 0 3px rgba(119,172,255,0.5))" } : {}),
                                }}
                                data-slot-overlay-entry="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onAssignSlotToSelectedLabel(slot.id);
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                              />
                            );
                          })}

                          {/* Drag preview: dashed connector + faded label at nearest slot */}
                          {dragPreviewSlotEntry && selectedLabelPreview?.bubbleAnchor && (() => {
                            const dpAngleDeg = (dragPreviewSlotEntry.slot.angle * 180) / Math.PI;
                            const dpNormDeg = ((dpAngleDeg % 360) + 360) % 360;
                            const dpRotation = dpNormDeg > 90 && dpNormDeg < 270 ? dpAngleDeg + 180 : dpAngleDeg;
                            return (
                              <g opacity="0.55" pointerEvents="none">
                                <path
                                  d={buildAssignedConnectorPath(
                                    selectedLabelPreview.bubbleAnchor,
                                    dragPreviewSlotEntry.slot.connectorAnchor,
                                  )}
                                  stroke={selectedLabelPreview.connectorStroke}
                                  strokeWidth="0.8"
                                  fill="none"
                                  strokeDasharray="4 3"
                                  strokeLinecap="round"
                                />
                                <text
                                  x={dragPreviewSlotEntry.slot.labelAnchor.x}
                                  y={dragPreviewSlotEntry.slot.labelAnchor.y}
                                  textAnchor={dragPreviewSlotEntry.slot.textAnchor}
                                  dominantBaseline="middle"
                                  fontFamily={selectedLabelPreview.fontFamily}
                                  fontSize={selectedLabelPreview.fontSize}
                                  fill="#555"
                                  transform={`rotate(${dpRotation} ${dragPreviewSlotEntry.slot.labelAnchor.x} ${dragPreviewSlotEntry.slot.labelAnchor.y})`}
                                >
                                  {selectedLabelPreview.text}
                                </text>
                              </g>
                            );
                          })()}

                          {/* Ghost label following cursor during drag */}
                          {isLabelDragging && selectedLabelPreview && labelDragState?.mouseSvgPoint && (
                            <text
                              x={labelDragState.mouseSvgPoint.x + 12}
                              y={labelDragState.mouseSvgPoint.y - 8}
                              textAnchor="start"
                              dominantBaseline="middle"
                              fontFamily={selectedLabelPreview.fontFamily}
                              fontSize={selectedLabelPreview.fontSize}
                              fill="#333"
                              opacity="0.7"
                              pointerEvents="none"
                            >
                              {selectedLabelPreview.text}
                            </text>
                          )}

                          {/* Tooltip above bubble during label drag */}
                          {isLabelDragging && selectedLabelPreview?.bubbleAnchor && (() => {
                            const tooltipWidth = estimateLabelWidth(selectedLabelPreview.text, 10) + 16;
                            return (
                              <g pointerEvents="none">
                                <rect
                                  x={selectedLabelPreview.bubbleAnchor.x - tooltipWidth / 2}
                                  y={selectedLabelPreview.bubbleAnchor.y - 36}
                                  width={tooltipWidth}
                                  height={20}
                                  rx={4}
                                  fill="rgba(30,30,30,0.85)"
                                />
                                <text
                                  x={selectedLabelPreview.bubbleAnchor.x}
                                  y={selectedLabelPreview.bubbleAnchor.y - 26}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontFamily="Open Sans, sans-serif"
                                  fontSize="10"
                                  fill="white"
                                >
                                  {selectedLabelPreview.text}
                                </text>
                              </g>
                            );
                          })()}

                        </g>
                      )}

                      {/* Bubble hover tooltip (when not dragging) */}
                      {hoveredBubble && !labelDragState && (() => {
                        const tooltipWidth = estimateLabelWidth(hoveredBubble.label, 10) + 16;
                        return (
                          <g pointerEvents="none">
                            <rect
                              x={hoveredBubble.x - tooltipWidth / 2}
                              y={hoveredBubble.y - 36}
                              width={tooltipWidth}
                              height={20}
                              rx={4}
                              fill="rgba(30,30,30,0.85)"
                            />
                            <text
                              x={hoveredBubble.x}
                              y={hoveredBubble.y - 26}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontFamily="Open Sans, sans-serif"
                              fontSize="10"
                              fill="white"
                            >
                              {hoveredBubble.label}
                            </text>
                          </g>
                        );
                      })()}
                    </svg>
                  )}
                </div>
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
