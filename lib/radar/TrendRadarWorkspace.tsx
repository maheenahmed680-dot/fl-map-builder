"use client";

import { useEffect, useState } from "react";
import { TrendRadarPreview } from "@/lib/radar/TrendRadarPreview";
import { TrendRadarSidebar } from "@/lib/radar/TrendRadarSidebar";
import {
  bubbleAssetUrls,
  type BubbleAssetMap,
  type BubbleOverride,
  type BubbleType,
} from "@/lib/radar/radarConfig";
import { transformTrendRadarHtmlToStyledSvg } from "@/lib/radar/transformTrendRadarHtml";

type BubbleSelectionKey = string;

type BubbleMeta = {
  id: BubbleSelectionKey;
  clusterId: string | null;
  trend: string | null;
  label: string;
  type: BubbleType | "";
};

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

function toBubbleSelectionKey(clusterId: string | null, trend: string | null): BubbleSelectionKey | null {
  if (clusterId) return `cluster:${clusterId}`;
  if (trend) return `trend:${trend}`;
  return null;
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

function findBubbleLabelNodeByTrend(svg: SVGSVGElement, trend: string | null) {
  const labelsGroup = svg.querySelector("#radar-labels-outer");
  if (!labelsGroup || !trend) return null;

  return labelsGroup.querySelector<SVGTextElement>(
    `text[data-trend="${escapeAttributeValue(trend)}"]`,
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
  const [bubbleAssets, setBubbleAssets] = useState<BubbleAssetMap>(emptyAssets);
  const [logoAsset, setLogoAsset] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [fileName, setFileName] = useState("");
  const [baseSvgMarkup, setBaseSvgMarkup] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [baseBubbleIndexByKey, setBaseBubbleIndexByKey] = useState<Record<BubbleSelectionKey, BubbleMeta>>({});
  const [selectedBubbleKey, setSelectedBubbleKey] = useState<BubbleSelectionKey | null>(null);
  const [bubbleOverridesByKey, setBubbleOverridesByKey] = useState<Record<BubbleSelectionKey, BubbleOverride>>({});

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
    let active = true;

    async function runTransform() {
      if (!rawHtml.trim()) {
        setBaseSvgMarkup("");
        setWarnings([]);
        setBaseBubbleIndexByKey({});
        setSelectedBubbleKey(null);
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
    const svg =
      parsed.documentElement?.tagName.toLowerCase() === "svg"
        ? (parsed.documentElement as SVGSVGElement)
        : parsed.querySelector("svg");

    if (!svg) {
      setBaseBubbleIndexByKey({});
      return;
    }

    const nextBubbleIndexByKey: Record<BubbleSelectionKey, BubbleMeta> = {};
    svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble").forEach((bubbleNode) => {
      const clusterId = normalizeSvgValue(bubbleNode.getAttribute("data-cluster-id"));
      const trend = normalizeSvgValue(bubbleNode.getAttribute("data-trend"));
      const selectionKey = toBubbleSelectionKey(clusterId, trend);
      if (!selectionKey) return;

      const currentBubble = nextBubbleIndexByKey[selectionKey];
      const labelByClusterId = findBubbleLabelNodeByClusterId(svg, clusterId);
      const labelByTrend = findBubbleLabelNodeByTrend(svg, trend);
      const label =
        normalizeSvgValue(labelByClusterId?.textContent) ??
        normalizeSvgValue(labelByTrend?.textContent) ??
        trend ??
        currentBubble?.label ??
        "";
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
      const selectionKey = toBubbleSelectionKey(clusterId, trend);
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

  async function handleUploadFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setRawHtml(text);
    setBubbleOverridesByKey({});
    setSelectedBubbleKey(null);
  }

  const selectedBubbleBase = selectedBubbleKey ? baseBubbleIndexByKey[selectedBubbleKey] ?? null : null;
  const selectedBubbleOverride = selectedBubbleKey ? bubbleOverridesByKey[selectedBubbleKey] ?? null : null;
  const selectedBubbleLabelFallback =
    selectedBubbleKey?.startsWith("trend:") ? selectedBubbleKey.slice("trend:".length) : "";
  const selectedBubble = selectedBubbleKey
    ? {
        id: selectedBubbleKey,
        label: selectedBubbleOverride?.label ?? selectedBubbleBase?.label ?? selectedBubbleLabelFallback,
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

  return (
    <div
      className={
        sidebarOpen
          ? "grid min-h-[780px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_435px] xl:gap-0"
          : "grid min-h-[780px] grid-cols-1 gap-4"
      }
    >
      <TrendRadarPreview
        onBubbleSelect={setSelectedBubbleKey}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        selectedBubbleKey={selectedBubbleKey}
        sidebarOpen={sidebarOpen}
        svgMarkup={baseSvgMarkup}
        warnings={warnings}
      />

      {sidebarOpen && (
        <TrendRadarSidebar
          bubbleEditorDisabled={!selectedBubble}
          fileName={fileName}
          selectedBubble={selectedBubble}
          onBubbleLabelChange={handleBubbleLabelChange}
          onBubbleTypeChange={handleBubbleTypeChange}
          onDownloadSvg={handleDownloadSvg}
          onHidePanel={() => setSidebarOpen(false)}
          onUploadFile={handleUploadFile}
        />
      )}
    </div>
  );
}
