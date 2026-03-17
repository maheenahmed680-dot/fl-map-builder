"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TrendRadarPreview,
  type PreviewSlotOverlayEntry,
  type SelectedRadarLabelPayload,
} from "@/lib/radar/TrendRadarPreview";
import { TrendRadarSidebar } from "@/lib/radar/TrendRadarSidebar";
import {
  bubbleAssetUrls,
  type BubbleAssetMap,
  type BubbleOverride,
  type BubbleType,
} from "@/lib/radar/radarConfig";
import {
  estimateLabelWidth,
  findNearestRadarLabelSlot,
  generateRadarLabelSlotsFromSvgMarkup,
  getTextAnchorForAngle,
  indexRadarLabelSlotsById,
  readRadarGeometryFromSvgMarkup,
  readRadarRenderedLabelsFromSvgMarkup,
  classifyRadarLabelSideFromTheta,
  type RadarGeometry,
  type RadarLabelSide,
  type RadarLabelSlot,
  type RadarRenderedLabel,
  type RadarTextAnchor,
} from "@/lib/radar/radarLabelSlots";
import { transformTrendRadarHtmlToStyledSvg } from "@/lib/radar/transformTrendRadarHtml";

type BubbleSelectionKey = string;

type BubbleMeta = {
  id: BubbleSelectionKey;
  clusterId: string | null;
  trend: string | null;
  label: string;
  type: BubbleType | "";
};

type LabelSlotAssignmentMap = Record<BubbleSelectionKey, string>;

type PreviewSlotAssignment = {
  selectionKey: BubbleSelectionKey;
  label: RadarRenderedLabel;
  slot: RadarLabelSlot;
};

type Point = {
  x: number;
  y: number;
};

type EffectiveOuterLabelPlacement = {
  clusterId: string;
  text: string;
  labelAnchor: Point;
  textAnchor: RadarTextAnchor;
  fontSize: number;
  side: RadarLabelSide;
};

type LabelBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type LaneAxis = "x" | "y";

type LaneDefinition = {
  axis: LaneAxis;
  fixed: number;
  min: number;
  max: number;
};

const DESIRED_FREE_LANE_SLOT_COUNT = 7;
const MIN_FREE_LANE_SLOT_COUNT = 5;
const MAX_FREE_LANE_SLOT_COUNT = 8;
const MIN_RAW_LANE_SLOT_COUNT = 14;
const MAX_RAW_LANE_SLOT_COUNT = 24;

const emptyAssets: BubbleAssetMap = {
  "Sehr hoch": "",
  Hoch: "",
  Niedrig: "",
  "Sehr niedrig": "",
};

const bubbleTypeByBucket: Record<string, BubbleType> = {
  "4": "Sehr hoch",
  "3": "Hoch",
  "2": "Niedrig",
  "1": "Sehr niedrig",
};

function normalizeSvgValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function findRenderedLabelByClusterId(
  baseRenderedLabelsByKey: Record<BubbleSelectionKey, RadarRenderedLabel>,
  selectionKey: string | null,
) {
  if (!selectionKey) return null;

  // Direct lookup by key (keys are now raw selection values)
  if (baseRenderedLabelsByKey[selectionKey]) return baseRenderedLabelsByKey[selectionKey];

  // Fallback: scan values matching clusterId, trend, or selectionKey
  return Object.values(baseRenderedLabelsByKey).find(
    (label) =>
      label.clusterId === selectionKey ||
      label.trend === selectionKey ||
      label.selectionKey === selectionKey,
  ) ?? null;
}

function normalizeBubbleType(value: string | null | undefined): BubbleType | null {
  const normalized = normalizeSvgValue(value);
  if (!normalized) return null;

  return normalized === "Sehr hoch" ||
    normalized === "Hoch" ||
    normalized === "Niedrig" ||
    normalized === "Sehr niedrig"
    ? normalized
    : null;
}

function toFontSizePx(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? Math.max(parsed, 10) : 12;
}

function dedupeSlotsById(slots: RadarLabelSlot[]) {
  return slots.reduce<RadarLabelSlot[]>((nextSlots, slot) => {
    if (nextSlots.some((existingSlot) => existingSlot.id === slot.id)) {
      return nextSlots;
    }

    nextSlots.push(slot);
    return nextSlots;
  }, []);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getDefaultTextAnchorForSide(side: RadarLabelSide): RadarTextAnchor {
  if (side === "left") return "end";
  if (side === "right") return "start";
  return "middle";
}

function createPrimarySlotId(side: RadarLabelSide, labelAnchor: Point) {
  return `primary:${side}:${Math.round(labelAnchor.x * 10)}:${Math.round(labelAnchor.y * 10)}`;
}

function createEmptyLaneSlotId(side: RadarLabelSide, labelAnchor: Point) {
  return `lane:${side}:${Math.round(labelAnchor.x * 10)}:${Math.round(labelAnchor.y * 10)}`;
}

function sortLaneValuesForSide(side: RadarLabelSide, leftPoint: Point, rightPoint: Point) {
  if (side === "left" || side === "right") {
    return leftPoint.y - rightPoint.y;
  }

  return leftPoint.x - rightPoint.x;
}

function getNearestBaseSlotOnSide(baseLabelSlots: RadarLabelSlot[], side: RadarLabelSide, labelAnchor: Point) {
  return (
    findNearestRadarLabelSlot(
      labelAnchor,
      baseLabelSlots.filter((slot) => slot.side === side),
    ) ?? findNearestRadarLabelSlot(labelAnchor, baseLabelSlots)
  );
}

function projectPointToGreyRing(point: Point, geometry: RadarGeometry) {
  const dx = point.x - geometry.center.x;
  const dy = point.y - geometry.center.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 0) {
    return { x: geometry.center.x, y: geometry.center.y - geometry.greyRingRadius };
  }

  const scale = geometry.greyRingRadius / distance;
  return {
    x: geometry.center.x + dx * scale,
    y: geometry.center.y + dy * scale,
  };
}


function buildApproximateLabelBounds(
  labelAnchor: Point,
  textAnchor: RadarTextAnchor,
  text: string,
  fontSize: number,
): LabelBounds {
  const width = estimateLabelWidth(text, fontSize);
  const height = Math.max(12, fontSize * 1.18);

  if (textAnchor === "end") {
    return {
      minX: labelAnchor.x - width,
      maxX: labelAnchor.x,
      minY: labelAnchor.y - height / 2,
      maxY: labelAnchor.y + height / 2,
    };
  }

  if (textAnchor === "middle") {
    return {
      minX: labelAnchor.x - width / 2,
      maxX: labelAnchor.x + width / 2,
      minY: labelAnchor.y - height / 2,
      maxY: labelAnchor.y + height / 2,
    };
  }

  return {
    minX: labelAnchor.x,
    maxX: labelAnchor.x + width,
    minY: labelAnchor.y - height / 2,
    maxY: labelAnchor.y + height / 2,
  };
}

function boundsOverlap(leftBounds: LabelBounds, rightBounds: LabelBounds, padding = 0) {
  return !(
    leftBounds.maxX + padding < rightBounds.minX ||
    rightBounds.maxX + padding < leftBounds.minX ||
    leftBounds.maxY + padding < rightBounds.minY ||
    rightBounds.maxY + padding < leftBounds.minY
  );
}

function getLaneDefinition(side: RadarLabelSide, geometry: RadarGeometry): LaneDefinition {
  switch (side) {
    case "left":
      return {
        axis: "y",
        fixed: geometry.center.x - geometry.labelGuideRadius,
        min: geometry.center.y - geometry.slotSpanY * 1.06,
        max: geometry.center.y + geometry.slotSpanY * 1.06,
      };
    case "right":
      return {
        axis: "y",
        fixed: geometry.center.x + geometry.labelGuideRadius,
        min: geometry.center.y - geometry.slotSpanY * 1.06,
        max: geometry.center.y + geometry.slotSpanY * 1.06,
      };
    case "top":
      return {
        axis: "x",
        fixed: geometry.center.y - geometry.labelGuideRadius,
        min: geometry.center.x - geometry.slotSpanX * 1.06,
        max: geometry.center.x + geometry.slotSpanX * 1.06,
      };
    case "bottom":
      return {
        axis: "x",
        fixed: geometry.center.y + geometry.labelGuideRadius,
        min: geometry.center.x - geometry.slotSpanX * 1.06,
        max: geometry.center.x + geometry.slotSpanX * 1.06,
      };
  }
}

function getAxisValue(point: Point, axis: LaneAxis) {
  return axis === "x" ? point.x : point.y;
}

function buildEmptyLaneSlot(
  side: RadarLabelSide,
  axisValue: number,
  sideIndex: number,
  sideCount: number,
  geometry: RadarGeometry,
) {
  let labelAnchor: Point;

  switch (side) {
    case "left":
    case "right":
      labelAnchor = {
        x: side === "left" ? geometry.center.x - geometry.labelGuideRadius : geometry.center.x + geometry.labelGuideRadius,
        y: axisValue,
      };
      break;
    case "top":
    case "bottom":
      labelAnchor = {
        x: axisValue,
        y: side === "top" ? geometry.center.y - geometry.labelGuideRadius : geometry.center.y + geometry.labelGuideRadius,
      };
      break;
  }

  const connectorAnchor = projectPointToGreyRing(labelAnchor, geometry);

  return {
    id: createEmptyLaneSlotId(side, labelAnchor),
    side,
    sideIndex,
    sideCount,
    angle: Math.atan2(connectorAnchor.y - geometry.center.y, connectorAnchor.x - geometry.center.x),
    textAnchor: getDefaultTextAnchorForSide(side),
    labelAnchor,
    connectorAnchor,
  } satisfies RadarLabelSlot;
}

function groupSequentialSlots(slots: RadarLabelSlot[]) {
  if (slots.length === 0) return [] as RadarLabelSlot[][];

  return slots.reduce<RadarLabelSlot[][]>((groups, slot) => {
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup || slot.sideIndex !== currentGroup[currentGroup.length - 1].sideIndex + 1) {
      groups.push([slot]);
      return groups;
    }

    currentGroup.push(slot);
    return groups;
  }, []);
}

function sampleEvenlyFromArray<T>(items: T[], targetCount: number) {
  if (targetCount <= 0 || items.length === 0) return [] as T[];
  if (items.length <= targetCount) return items;

  const nextIndexes = new Set<number>();
  for (let index = 0; index < targetCount; index += 1) {
    const ratio = targetCount === 1 ? 0.5 : index / (targetCount - 1);
    nextIndexes.add(Math.round(ratio * (items.length - 1)));
  }

  return [...nextIndexes]
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex)
    .map((itemIndex) => items[itemIndex]);
}

function buildSelectedSideEmptyLaneSlots({
  currentSlot,
  geometry,
  placements,
  selectedClusterId,
  selectedFontSize,
  selectedText,
  side,
  desiredCount = DESIRED_FREE_LANE_SLOT_COUNT,
  minimumCount = MIN_FREE_LANE_SLOT_COUNT,
}: {
  currentSlot: RadarLabelSlot | null;
  geometry: RadarGeometry;
  placements: EffectiveOuterLabelPlacement[];
  selectedClusterId: string;
  selectedFontSize: number;
  selectedText: string;
  side: RadarLabelSide;
  desiredCount?: number;
  minimumCount?: number;
}) {
  const lane = getLaneDefinition(side, geometry);
  const span = Math.max(1, lane.max - lane.min);
  const approximateSpacing =
    lane.axis === "y"
      ? Math.max(24, selectedFontSize * 2)
      : Math.max(30, Math.min(estimateLabelWidth(selectedText, selectedFontSize) * 0.34, 52));
  const rawSlotCount = clamp(
    Math.ceil(span / Math.max(16, approximateSpacing * 0.72)) + 1,
    MIN_RAW_LANE_SLOT_COUNT,
    MAX_RAW_LANE_SLOT_COUNT,
  );
  const currentAnchor = currentSlot?.labelAnchor ?? null;
  const otherPlacements = placements.filter((placement) => placement.clusterId !== selectedClusterId);

  const freeLaneSlots = Array.from({ length: rawSlotCount }, (_, sideIndex) => {
    const ratio = rawSlotCount <= 1 ? 0.5 : sideIndex / (rawSlotCount - 1);
    const axisValue = lane.min + span * ratio;
    return buildEmptyLaneSlot(side, axisValue, sideIndex, rawSlotCount, geometry);
  }).filter((slot) => {
    if (currentAnchor && Math.hypot(slot.labelAnchor.x - currentAnchor.x, slot.labelAnchor.y - currentAnchor.y) <= 14) {
      return false;
    }

    const candidateBounds = buildApproximateLabelBounds(
      slot.labelAnchor,
      slot.textAnchor,
      selectedText,
      selectedFontSize,
    );

    return otherPlacements.every((placement) => {
      const anchorDistance = Math.hypot(
        placement.labelAnchor.x - slot.labelAnchor.x,
        placement.labelAnchor.y - slot.labelAnchor.y,
      );
      const anchorClearance =
        lane.axis === "y"
          ? Math.max(24, (placement.fontSize + selectedFontSize) * 0.92)
          : Math.max(28, (estimateLabelWidth(placement.text, placement.fontSize) + estimateLabelWidth(selectedText, selectedFontSize)) * 0.24);

      if (anchorDistance <= anchorClearance) {
        return false;
      }

      const placementBounds = buildApproximateLabelBounds(
        placement.labelAnchor,
        placement.textAnchor,
        placement.text,
        placement.fontSize,
      );

      return !boundsOverlap(candidateBounds, placementBounds, 8);
    });
  });

  if (freeLaneSlots.length === 0) return [] as RadarLabelSlot[];

  const currentAxisValue = currentAnchor ? getAxisValue(currentAnchor, lane.axis) : (lane.min + lane.max) / 2;
  const rankedGroups = groupSequentialSlots(freeLaneSlots).sort((leftGroup, rightGroup) => {
    if (rightGroup.length !== leftGroup.length) {
      return rightGroup.length - leftGroup.length;
    }

    const leftCenter = getAxisValue(leftGroup[Math.floor(leftGroup.length / 2)].labelAnchor, lane.axis);
    const rightCenter = getAxisValue(rightGroup[Math.floor(rightGroup.length / 2)].labelAnchor, lane.axis);
    const leftDistance = Math.abs(leftCenter - currentAxisValue);
    const rightDistance = Math.abs(rightCenter - currentAxisValue);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return leftGroup[0].sideIndex - rightGroup[0].sideIndex;
  });

  const selectedSlots: RadarLabelSlot[] = [];
  rankedGroups.forEach((group) => {
    if (selectedSlots.length >= desiredCount) return;

    const remainingCount = desiredCount - selectedSlots.length;
    const sampledGroup = group.length > remainingCount ? sampleEvenlyFromArray(group, remainingCount) : group;
    selectedSlots.push(...sampledGroup);
  });

  if (selectedSlots.length < minimumCount) {
    const remainingSlots = freeLaneSlots.filter(
      (slot) => !selectedSlots.some((selectedSlot) => selectedSlot.id === slot.id),
    );
    selectedSlots.push(
      ...sampleEvenlyFromArray(
        remainingSlots,
        Math.min(desiredCount - selectedSlots.length, minimumCount - selectedSlots.length),
      ),
    );
  }

  return dedupeSlotsById(selectedSlots).sort((leftSlot, rightSlot) => leftSlot.sideIndex - rightSlot.sideIndex).slice(0, MAX_FREE_LANE_SLOT_COUNT);
}

function resolvePreviewAssignedSlot(
  slotId: string | null,
  baseLabelSlots: RadarLabelSlot[],
  baseSlotsById: Record<string, RadarLabelSlot>,
  radarGeometry: RadarGeometry | null,
) {
  if (!slotId) return null;
  if (baseSlotsById[slotId]) return baseSlotsById[slotId];

  // Arc or gap-based slot IDs: "arc:<theta*10000>" or "gap:<theta*10000>" — reconstruct from geometry
  const thetaMatch = slotId.match(/^(?:arc|gap):(-?\d+)$/);
  if (thetaMatch && radarGeometry) {
    const theta = Number.parseInt(thetaMatch[1], 10) / 10000;
    const r = radarGeometry.labelGuideRadius;
    const { center } = radarGeometry;
    const OUTWARD_OFFSET = 14;
    const CONNECTOR_INSET = 8;
    const labelAnchor = {
      x: center.x + (r + OUTWARD_OFFSET) * Math.cos(theta),
      y: center.y + (r + OUTWARD_OFFSET) * Math.sin(theta),
    };
    const connectorAnchor = {
      x: center.x + (r - CONNECTOR_INSET) * Math.cos(theta),
      y: center.y + (r - CONNECTOR_INSET) * Math.sin(theta),
    };
    const side = classifyRadarLabelSideFromTheta(theta);
    return {
      id: slotId,
      side,
      sideIndex: 0,
      sideCount: 0,
      angle: theta,
      textAnchor: getTextAnchorForAngle(theta),
      labelAnchor,
      connectorAnchor,
    } satisfies RadarLabelSlot;
  }

  // Legacy lane/primary slot IDs: "primary|lane:<side>:<x*10>:<y*10>"
  const editableMatch = slotId.match(/^(primary|lane):(left|right|top|bottom):(-?\d+):(-?\d+)$/);
  if (!editableMatch) return null;

  const side = editableMatch[2] as RadarLabelSide;
  const labelAnchor = {
    x: Number.parseInt(editableMatch[3], 10) / 10,
    y: Number.parseInt(editableMatch[4], 10) / 10,
  };
  const nearestBaseSlot = getNearestBaseSlotOnSide(baseLabelSlots, side, labelAnchor);
  const connectorAnchor = radarGeometry
    ? projectPointToGreyRing(labelAnchor, radarGeometry)
    : nearestBaseSlot?.connectorAnchor ?? labelAnchor;

  return {
    id: slotId,
    side,
    sideIndex: 0,
    sideCount: 0,
    angle: nearestBaseSlot?.angle ?? 0,
    textAnchor: getDefaultTextAnchorForSide(side),
    labelAnchor,
    connectorAnchor,
  } satisfies RadarLabelSlot;
}

function buildPrimaryLaneSlots(
  placements: EffectiveOuterLabelPlacement[],
  baseLabelSlots: RadarLabelSlot[],
) {
  const sides: RadarLabelSide[] = ["left", "right", "top", "bottom"];
  const primarySlotsBySide = sides.reduce<Record<RadarLabelSide, RadarLabelSlot[]>>(
    (index, side) => {
      index[side] = [];
      return index;
    },
    {
      left: [],
      right: [],
      top: [],
      bottom: [],
    },
  );
  const primarySlotByClusterId: Record<string, RadarLabelSlot> = {};

  sides.forEach((side) => {
    const sidePlacements = placements
      .filter((placement) => placement.side === side)
      .sort((leftPlacement, rightPlacement) =>
        sortLaneValuesForSide(side, leftPlacement.labelAnchor, rightPlacement.labelAnchor),
      );

    primarySlotsBySide[side] = sidePlacements.map((placement, sideIndex) => {
      const nearestBaseSlot = getNearestBaseSlotOnSide(baseLabelSlots, side, placement.labelAnchor);
      const primarySlot = {
        id: createPrimarySlotId(side, placement.labelAnchor),
        side,
        sideIndex,
        sideCount: sidePlacements.length,
        angle: nearestBaseSlot?.angle ?? 0,
        textAnchor: placement.textAnchor,
        labelAnchor: placement.labelAnchor,
        connectorAnchor: nearestBaseSlot?.connectorAnchor ?? placement.labelAnchor,
      } satisfies RadarLabelSlot;

      primarySlotByClusterId[placement.clusterId] = primarySlot;
      return primarySlot;
    });
  });

  return {
    primarySlotsBySide,
    primarySlotByClusterId,
  };
}

function getBubbleTypeFromBucket(bucket: string | null | undefined): BubbleType | null {
  const normalizedBucket = normalizeSvgValue(bucket);
  return normalizedBucket ? bubbleTypeByBucket[normalizedBucket] ?? null : null;
}

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function findBubbleLabelNodeByClusterId(svg: SVGSVGElement, clusterId: string | null) {
  const labelsGroup = svg.querySelector("#radar-labels-outer");
  if (!labelsGroup || !clusterId) return null;

  return labelsGroup.querySelector<SVGTextElement>(
    `text[data-cluster-id="${escapeAttributeValue(clusterId)}"]`,
  );
}

function getSvgDownloadFileName(fileName: string) {
  const normalized = fileName.trim();
  if (!normalized) return "trend-radar.svg";

  const baseName = normalized.replace(/\.[^/.]+$/, "");
  return `${baseName || "trend-radar"}.svg`;
}

function getPreviewSvgElement() {
  return document.querySelector(".trend-preview-svg svg") as SVGSVGElement | null;
}

function getFallbackSvgElement(svgMarkup: string) {
  if (!svgMarkup.trim()) return null;

  const parsed = new DOMParser().parseFromString(svgMarkup, "text/html");
  return parsed.querySelector("svg") as SVGSVGElement | null;
}

type SvgExportStats = {
  hrefRootRelativeCount: number;
  xlinkHrefRootRelativeCount: number;
  radarBubblePathCount: number;
  outerLabelCount: number;
  viewBox: string | null;
};

function isRootRelativeAssetPath(value: string | null | undefined) {
  return Boolean(value?.trim().startsWith("/"));
}

async function assetPathToDataUrl(assetPath: string, cache: Map<string, string>) {
  const cached = cache.get(assetPath);
  if (cached) return cached;

  const response = await fetch(new URL(assetPath, window.location.origin).toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch SVG asset for export: ${assetPath} (${response.status})`);
  }

  const blob = await response.blob();
  const mimeType =
    blob.type || (assetPath.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
  cache.set(assetPath, dataUrl);
  return dataUrl;
}

async function buildDownloadableSvgMarkup(svgElement: SVGSVGElement) {
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  svgClone.querySelectorAll("parsererror").forEach((node) => node.remove());

  svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svgClone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  const assetCache = new Map<string, string>();
  for (const image of Array.from(svgClone.querySelectorAll("image"))) {
    const href = image.getAttribute("href")?.trim() ?? null;
    const xlinkHref =
      image.getAttribute("xlink:href")?.trim() ??
      image.getAttributeNS("http://www.w3.org/1999/xlink", "href")?.trim() ??
      null;
    const assetPath = isRootRelativeAssetPath(href)
      ? href
      : isRootRelativeAssetPath(xlinkHref)
      ? xlinkHref
      : null;

    if (!assetPath) continue;

    const dataUrl = await assetPathToDataUrl(assetPath, assetCache);
    image.setAttribute("href", dataUrl);
    image.setAttribute("xlink:href", dataUrl);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
  }

  const xml = new XMLSerializer().serializeToString(svgClone);
  const stats: SvgExportStats = {
    hrefRootRelativeCount: (xml.match(/\shref="\/[^"]*"/g) ?? []).length,
    xlinkHrefRootRelativeCount: (xml.match(/\sxlink:href="\/[^"]*"/g) ?? []).length,
    radarBubblePathCount: (xml.match(/\/radar-bubbles\//g) ?? []).length,
    outerLabelCount: svgClone.querySelectorAll("#radar-labels-outer text").length,
    viewBox: svgClone.getAttribute("viewBox"),
  };

  if (stats.hrefRootRelativeCount > 0 || stats.xlinkHrefRootRelativeCount > 0 || stats.radarBubblePathCount > 0) {
    throw new Error(
      `Standalone SVG export still contains root-relative assets: ${JSON.stringify(stats)}`,
    );
  }

  return { xml, stats };
}

export function TrendRadarWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [slotOverlayVisible, setSlotOverlayVisible] = useState(false);
  const [bubbleAssets, setBubbleAssets] = useState<BubbleAssetMap>(emptyAssets);
  const [logoAsset, setLogoAsset] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [fileName, setFileName] = useState("");
  const [baseSvgMarkup, setBaseSvgMarkup] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [baseBubbleIndexByKey, setBaseBubbleIndexByKey] = useState<Record<BubbleSelectionKey, BubbleMeta>>({});
  const [selectedLabel, setSelectedLabel] = useState<SelectedRadarLabelPayload | null>(null);
  const [bubbleOverridesByKey, setBubbleOverridesByKey] = useState<Record<BubbleSelectionKey, BubbleOverride>>({});
  const [baseLabelSlots, setBaseLabelSlots] = useState<RadarLabelSlot[]>([]);
  const [baseRenderedLabelsByKey, setBaseRenderedLabelsByKey] = useState<Record<BubbleSelectionKey, RadarRenderedLabel>>(
    {},
  );
  const [labelSlotAssignmentsByKey, setLabelSlotAssignmentsByKey] = useState<LabelSlotAssignmentMap>({});
  const [savedSlotAssignmentsByKey, setSavedSlotAssignmentsByKey] = useState<LabelSlotAssignmentMap>({});
  const [saveEditsNotice, setSaveEditsNotice] = useState<string | null>(null);
  const selectedBubbleKey = selectedLabel?.clusterId ?? null;

  // Detect unsaved slot edits by comparing working state to saved state
  const hasPendingSlotEdits = useMemo(() => {
    const workingKeys = Object.keys(labelSlotAssignmentsByKey);
    const savedKeys = Object.keys(savedSlotAssignmentsByKey);
    if (workingKeys.length !== savedKeys.length) return true;
    return workingKeys.some((key) => labelSlotAssignmentsByKey[key] !== savedSlotAssignmentsByKey[key]);
  }, [labelSlotAssignmentsByKey, savedSlotAssignmentsByKey]);

  useEffect(() => {
    let active = true;

    async function loadBubbleAssets() {
      const [entries, logoText] = await Promise.all([
        Promise.all(
        (Object.entries(bubbleAssetUrls) as Array<[BubbleType, string]>).map(async ([type, url]) => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return [type, await response.text()] as const;
          } catch {
            return [type, ""] as const;
          }
        }),
        ),
        fetch("/logo%20fl%20fav.svg")
          .then(async (response) => (response.ok ? response.text() : ""))
          .catch(() => ""),
      ]);

      if (!active) return;

      const nextAssets = entries.reduce<BubbleAssetMap>((acc, [type, text]) => {
        acc[type] = text;
        return acc;
      }, { ...emptyAssets });

      setBubbleAssets(nextAssets);
      setLogoAsset(logoText);
    }

    void loadBubbleAssets();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedBubbleKey) return;
    setSlotOverlayVisible(true);
  }, [selectedBubbleKey]);

  useEffect(() => {
    let active = true;

    async function runTransform() {
      if (!rawHtml.trim()) {
        setBaseSvgMarkup("");
        setWarnings([]);
        setBaseBubbleIndexByKey({});
        setSlotOverlayVisible(false);
        setSelectedLabel(null);
        setLabelSlotAssignmentsByKey({});
        setSavedSlotAssignmentsByKey({});
        setSaveEditsNotice(null);
        return;
      }

      const result = await transformTrendRadarHtmlToStyledSvg(rawHtml, {
        bubbleAssets,
        logoAsset,
      });

      if (!active) return;

      setBaseSvgMarkup(result.svg);
      setWarnings(result.warnings);
    }

    void runTransform();

    return () => {
      active = false;
    };
  }, [bubbleAssets, logoAsset, rawHtml]);

  useEffect(() => {
    if (!baseSvgMarkup.trim()) {
      setBaseBubbleIndexByKey({});
      return;
    }

    const parsed = new DOMParser().parseFromString(baseSvgMarkup, "image/svg+xml");
    const rootElement = parsed.documentElement;
    const svg =
      rootElement?.tagName.toLowerCase() === "svg"
        ? (rootElement as unknown as SVGSVGElement)
        : parsed.querySelector<SVGSVGElement>("svg");

    if (!svg) {
      setBaseBubbleIndexByKey({});
      return;
    }

    const nextBubbleIndexByKey: Record<BubbleSelectionKey, BubbleMeta> = {};
    svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble").forEach((bubbleNode) => {
      const clusterId = normalizeSvgValue(bubbleNode.getAttribute("data-cluster-id"));
      const trend = normalizeSvgValue(bubbleNode.getAttribute("data-trend"));
      const tooltip = normalizeSvgValue(bubbleNode.getAttribute("data-tooltip"));
      // Use best available key: data-cluster-id → data-trend → data-tooltip
      const selectionKey = clusterId ?? trend ?? tooltip;
      if (!selectionKey) return;

      const currentBubble = nextBubbleIndexByKey[selectionKey];
      // Try finding the label by cluster-id first, then by trend/tooltip
      const labelNode = clusterId
        ? findBubbleLabelNodeByClusterId(svg, clusterId)
        : (trend ? svg.querySelector<SVGTextElement>(`#radar-labels-outer text[data-trend="${trend}"]`) : null);
      const label =
        normalizeSvgValue(labelNode?.textContent) ?? trend ?? tooltip ?? currentBubble?.label ?? "";
      const typeFromData = normalizeBubbleType(bubbleNode.getAttribute("data-bubble-type"));
      const typeFromBucket = getBubbleTypeFromBucket(bubbleNode.getAttribute("data-bucket"));

      nextBubbleIndexByKey[selectionKey] = {
        id: selectionKey,
        clusterId: clusterId ?? currentBubble?.clusterId ?? null,
        trend: trend ?? currentBubble?.trend ?? null,
        label,
        type: typeFromData ?? typeFromBucket ?? currentBubble?.type ?? "",
      };
    });

    svg.querySelectorAll<SVGTextElement>("#radar-labels-outer text").forEach((labelNode) => {
      const clusterId = normalizeSvgValue(labelNode.getAttribute("data-cluster-id"));
      const trend = normalizeSvgValue(labelNode.getAttribute("data-trend"));
      const selectionKey = clusterId ?? trend;
      if (!selectionKey) return;

      const currentBubble = nextBubbleIndexByKey[selectionKey];
      const label = normalizeSvgValue(labelNode.textContent) ?? trend ?? currentBubble?.label ?? "";

      nextBubbleIndexByKey[selectionKey] = {
        id: selectionKey,
        clusterId: clusterId ?? currentBubble?.clusterId ?? null,
        trend: trend ?? currentBubble?.trend ?? null,
        label,
        type: currentBubble?.type ?? "",
      };
    });

    setBaseBubbleIndexByKey(nextBubbleIndexByKey);
  }, [baseSvgMarkup]);

  useEffect(() => {
    if (!baseSvgMarkup.trim()) {
      setBaseLabelSlots([]);
      setBaseRenderedLabelsByKey({});
      return;
    }

    setBaseLabelSlots(generateRadarLabelSlotsFromSvgMarkup(baseSvgMarkup));
    setBaseRenderedLabelsByKey(readRadarRenderedLabelsFromSvgMarkup(baseSvgMarkup));
  }, [baseSvgMarkup]);

  async function handleUploadFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setRawHtml(text);
    setBubbleOverridesByKey({});
    setSlotOverlayVisible(false);
    setLabelSlotAssignmentsByKey({});
    setSavedSlotAssignmentsByKey({});
    setSelectedLabel(null);
    setSaveEditsNotice(null);
  }

  const selectedBubbleBase = selectedBubbleKey ? baseBubbleIndexByKey[selectedBubbleKey] ?? null : null;
  const selectedBubbleOverride = selectedBubbleKey ? bubbleOverridesByKey[selectedBubbleKey] ?? null : null;
  const selectedBubble = selectedBubbleKey
    ? {
        id: selectedBubbleKey,
        label: selectedBubbleOverride?.label ?? selectedBubbleBase?.label ?? selectedLabel?.text ?? "",
        type: selectedBubbleOverride?.type ?? selectedBubbleBase?.type ?? "",
      }
    : null;

  function handleBubbleLabelChange(label: string) {
    if (!selectedBubbleKey) return;
    setBubbleOverridesByKey((current) => ({
      ...current,
      [selectedBubbleKey]: {
        ...current[selectedBubbleKey],
        label,
      },
    }));
  }

  function handleBubbleTypeChange(type: BubbleType) {
    if (!selectedBubbleKey) return;
    setBubbleOverridesByKey((current) => ({
      ...current,
      [selectedBubbleKey]: {
        ...current[selectedBubbleKey],
        type,
      },
    }));
  }

  function handleAssignSlotToSelectedLabel(slotId: string) {
    if (!selectedBubbleKey) return;
    console.debug("[slot-edit-debug]", {
      selectedClusterIdBeforeSlotClick: selectedBubbleKey,
      clickedSlotId: slotId,
      candidateSlotIdsBeforeReassignment: selectedCandidateSlotIds,
    });
    setSaveEditsNotice(null);
    setLabelSlotAssignmentsByKey((current) => ({
      ...current,
      [selectedBubbleKey]: slotId,
    }));
    console.debug("[slot-edit-debug]", {
      selectedClusterIdAfterSlotClick: selectedBubbleKey,
      newCurrentSlotIdAfterReassignment: slotId,
    });
  }

  function handleResolvedLabelSelection(nextSelectedLabel: SelectedRadarLabelPayload | null) {
    setSelectedLabel(nextSelectedLabel);
    console.debug("[slot-selection-debug]", {
      selectedClusterId: nextSelectedLabel?.clusterId ?? null,
      selectedLabelPayloadStored: Boolean(nextSelectedLabel),
    });
  }

  function handleSaveSlotEdits() {
    if (!hasPendingSlotEdits) return;

    // Commit: copy working state → saved state
    setSavedSlotAssignmentsByKey({ ...labelSlotAssignmentsByKey });
    const count = Object.keys(labelSlotAssignmentsByKey).length;
    console.info("Trend Radar slot edits saved.", { count, labelSlotAssignmentsByKey });
    setSaveEditsNotice(
      `${count} label position${count === 1 ? "" : "s"} saved.`,
    );
  }

  function handleHideSlotsWithRevert() {
    if (hasPendingSlotEdits) {
      // Revert: restore working state from saved state
      setLabelSlotAssignmentsByKey({ ...savedSlotAssignmentsByKey });
    }
    setSlotOverlayVisible(false);
  }

  function handleDownloadSvg() {
    void (async () => {
      try {
        const svg = getPreviewSvgElement() ?? getFallbackSvgElement(baseSvgMarkup);
        if (!svg) return;

        const { xml, stats } = await buildDownloadableSvgMarkup(svg);
        console.info("Trend Radar SVG export verification", stats);

        const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = getSvgDownloadFileName(fileName);
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (error) {
        console.error("Trend Radar SVG export failed", error);
      }
    })();
  }

  const radarGeometry = readRadarGeometryFromSvgMarkup(baseSvgMarkup);
  const baseSlotsById = indexRadarLabelSlotsById(baseLabelSlots);
  const selectedRenderedLabel = findRenderedLabelByClusterId(baseRenderedLabelsByKey, selectedBubbleKey);
  const selectedLabelText =
    (selectedBubbleKey ? bubbleOverridesByKey[selectedBubbleKey]?.label : null) ??
    selectedBubble?.label ??
    selectedLabel?.text ??
    selectedRenderedLabel?.text ??
    "";
  const selectedLabelFontSize = toFontSizePx(selectedRenderedLabel?.fontSize);
  const selectedLabelPreview = selectedRenderedLabel
    ? {
        bubbleAnchor: selectedRenderedLabel.bubbleAnchor,
        text: selectedLabelText,
        fontFamily: selectedRenderedLabel.fontFamily ?? "Open Sans, sans-serif",
        fontSize: selectedRenderedLabel.fontSize ?? "12",
        connectorStroke: selectedRenderedLabel.connector?.stroke ?? "#999",
      }
    : null;
  const selectedAssignedSlotId = selectedBubbleKey ? labelSlotAssignmentsByKey[selectedBubbleKey] ?? null : null;
  const selectedAssignedBaseSlot = resolvePreviewAssignedSlot(
    selectedAssignedSlotId,
    baseLabelSlots,
    baseSlotsById,
    radarGeometry,
  );
  const effectiveOuterLabelPlacements = Object.values(baseRenderedLabelsByKey).reduce<EffectiveOuterLabelPlacement[]>(
    (placements, label) => {
      const clusterId = normalizeSvgValue(label.clusterId);
      if (!clusterId) return placements;

      const assignedSlotId = labelSlotAssignmentsByKey[clusterId] ?? null;
      const assignedSlot = resolvePreviewAssignedSlot(assignedSlotId, baseLabelSlots, baseSlotsById, radarGeometry);
      const isSelectedLabel = clusterId === selectedBubbleKey;

      placements.push({
        clusterId,
        text:
          (bubbleOverridesByKey[clusterId]?.label ?? null) ??
          (isSelectedLabel ? selectedLabelText : null) ??
          label.text,
        labelAnchor:
          assignedSlot?.labelAnchor ??
          (isSelectedLabel && selectedLabel ? { x: selectedLabel.x, y: selectedLabel.y } : label.labelAnchor),
        textAnchor: assignedSlot?.textAnchor ?? (isSelectedLabel && selectedLabel ? selectedLabel.textAnchor : label.textAnchor),
        fontSize: toFontSizePx(label.fontSize),
        side: assignedSlot?.side ?? label.side,
      });
      return placements;
    },
    [],
  );
  if (selectedBubbleKey && selectedLabel && !effectiveOuterLabelPlacements.some((placement) => placement.clusterId === selectedBubbleKey)) {
    effectiveOuterLabelPlacements.push({
      clusterId: selectedBubbleKey,
      text: selectedLabelText,
      labelAnchor: selectedAssignedBaseSlot?.labelAnchor ?? { x: selectedLabel.x, y: selectedLabel.y },
      textAnchor: selectedAssignedBaseSlot?.textAnchor ?? selectedLabel.textAnchor,
      fontSize: selectedLabelFontSize,
      side: selectedAssignedBaseSlot?.side ?? selectedLabel.preferredSide,
    });
  }

  const { primarySlotsBySide, primarySlotByClusterId } = buildPrimaryLaneSlots(
    effectiveOuterLabelPlacements,
    baseLabelSlots,
  );
  const primarySlots = Object.values(primarySlotsBySide).flat();
  const primarySlotsById = indexRadarLabelSlotsById(primarySlots);
  const previewSlotsById = {
    ...baseSlotsById,
    ...primarySlotsById,
  };
  const assignedPreviewSlots = Object.entries(labelSlotAssignmentsByKey).reduce<PreviewSlotAssignment[]>(
    (assignments, [clusterId, slotId]) => {
      const label = findRenderedLabelByClusterId(baseRenderedLabelsByKey, clusterId);
      const slot =
        previewSlotsById[slotId] ?? resolvePreviewAssignedSlot(slotId, baseLabelSlots, baseSlotsById, radarGeometry);
      console.debug("[slot-assignment-chain]", {
        clusterId,
        slotId,
        labelFound: !!label,
        slotFound: !!slot,
        slotLabelAnchor: slot?.labelAnchor,
        labelBubbleAnchor: label?.bubbleAnchor,
      });
      if (!label || !slot) return assignments;

      assignments.push({
        selectionKey: clusterId,
        label,
        slot,
      });
      return assignments;
    },
    [],
  );
  const selectedCurrentSlot = selectedBubbleKey
    ? primarySlotByClusterId[selectedBubbleKey] ?? selectedAssignedBaseSlot ?? null
    : null;

  // Arc candidate slots are now computed in TrendRadarPreview using getBBox()-based
  // collision detection for accurate label avoidance. The workspace only provides the
  // "current" slot entry; available candidates are generated in the preview component.
  const selectedFreeLaneSlots: RadarLabelSlot[] = [];

  const selectedCandidateBaseSlots = dedupeSlotsById([
    ...(selectedCurrentSlot ? [selectedCurrentSlot] : []),
    ...selectedFreeLaneSlots,
  ]);
  const selectedSlotOverlayEntries = selectedCandidateBaseSlots.map<PreviewSlotOverlayEntry>((slot) => {
    const source = slot.id.startsWith("primary:") ? "primary" : "extra";

    if (selectedCurrentSlot && slot.id === selectedCurrentSlot.id) {
      return {
        slot,
        source,
        state: "current",
        occupiedByClusterId: null,
      };
    }

    return {
      slot,
      source,
      state: "available",
      occupiedByClusterId: null,
    };
  });
  const selectedCandidateSlotIds = selectedSlotOverlayEntries.map((entry) => entry.slot.id);
  const availableSlotCount = selectedSlotOverlayEntries.filter((entry) => entry.state === "available").length;
  const occupiedSlotCount = selectedSlotOverlayEntries.filter((entry) => entry.state === "occupied").length;
  const slotDebugMessage =
    selectedBubbleKey == null
      ? null
      : selectedLabel == null
      ? null
      : selectedSlotOverlayEntries.length === 0
      ? `No arc slots found for cluster ${selectedBubbleKey}. The label area may be too crowded.`
      : null;

  useEffect(() => {
    console.debug("[slot-candidate-debug]", {
      selectedClusterId: selectedBubbleKey,
      bubbleTheta: selectedLabel?.theta ?? null,
      currentSlotId: selectedCurrentSlot?.id ?? null,
      availableSlotCount,
      occupiedSlotCount,
      candidateSlotIds: selectedCandidateSlotIds,
    });
  }, [
    availableSlotCount,
    occupiedSlotCount,
    selectedBubbleKey,
    selectedCandidateSlotIds,
    selectedCurrentSlot?.id,
    selectedLabel?.theta,
  ]);

  useEffect(() => {
    setSaveEditsNotice(null);
  }, [labelSlotAssignmentsByKey]);

  return (
    <div
      className={
        sidebarOpen
          ? "grid min-h-[780px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_435px] xl:gap-0"
          : "grid min-h-[780px] grid-cols-1 gap-4"
      }
    >
      <TrendRadarPreview
        assignedPreviewSlots={assignedPreviewSlots}
        hasPendingSlotEdits={hasPendingSlotEdits}
        onAssignSlotToSelectedLabel={handleAssignSlotToSelectedLabel}
        onSaveSlotEdits={handleSaveSlotEdits}
        onSelectResolvedLabel={handleResolvedLabelSelection}
        onToggleSlotOverlay={() => {
          if (slotOverlayVisible) {
            handleHideSlotsWithRevert();
          } else {
            setSlotOverlayVisible(true);
          }
        }}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        selectedBubbleKey={selectedBubbleKey}
        selectedLabelPreview={selectedLabelPreview}
        selectedSlotKey={selectedBubbleKey}
        sidebarOpen={sidebarOpen}
        slotOverlayVisible={slotOverlayVisible}
        slotOverlayEntries={selectedSlotOverlayEntries}
        svgMarkup={baseSvgMarkup}
        warnings={warnings}
      />

      {sidebarOpen && (
        <TrendRadarSidebar
          bubbleEditorDisabled={!selectedBubble}
          fileName={fileName}
          pendingSlotAssignmentCount={Object.keys(labelSlotAssignmentsByKey).length}
          saveEditsNotice={saveEditsNotice}
          selectedBubble={selectedBubble}
          onBubbleLabelChange={handleBubbleLabelChange}
          onBubbleTypeChange={handleBubbleTypeChange}
          onDownloadSvg={handleDownloadSvg}
          onHidePanel={() => setSidebarOpen(false)}
          onSaveEdits={handleSaveSlotEdits}
          onUploadFile={handleUploadFile}
        />
      )}
    </div>
  );
}
