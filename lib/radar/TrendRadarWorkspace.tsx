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

  // Expand viewBox to prevent clipping of outer labels and PWLG text on export
  const currentViewBox = svgClone.getAttribute("viewBox");
  if (currentViewBox) {
    const parts = currentViewBox.split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [minX, minY, width, height] = parts;
      const pad = 200;
      svgClone.setAttribute(
        "viewBox",
        `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`
      );
    }
  }

  svgClone.querySelectorAll("text[font-size]").forEach(el => {
    const current = parseFloat(el.getAttribute("font-size") ?? "10");
    el.setAttribute("font-size", String(current * 1.2));
  });
const vbForStroke = svgClone.getAttribute("viewBox");
const vbPartsForStroke = vbForStroke ? vbForStroke.split(/\s+/).map(Number) : null;
const svgUnitsToPt = (vbPartsForStroke?.length === 4 && vbPartsForStroke.every(Number.isFinite))
  ? vbPartsForStroke[2] / 737
  : 1.9;
const targetStrokePt = 0.10;
svgClone.querySelectorAll("#radar-connectors path").forEach(el => {
  el.setAttribute("stroke-width", String(targetStrokePt * svgUnitsToPt));
});
svgClone.querySelectorAll("#radar-connectors path").forEach(el => {
  el.removeAttribute("opacity");
});

  svgClone.removeAttribute("width");
  svgClone.removeAttribute("height");
  svgClone.setAttribute("width", "737pt");
  svgClone.setAttribute("height", "737pt");

  svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svgClone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  let defs = svgClone.querySelector("defs");
if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); svgClone.prepend(defs); }
const fontResp = await fetch("https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsiH0C4n.woff2");
if (fontResp.ok) {
  const b64 = await fontResp.blob().then(b => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r((fr.result as string).split(",")[1]); fr.readAsDataURL(b); }));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `@font-face{font-family:'Open Sans';font-style:normal;font-weight:400;src:url('data:font/woff2;base64,${b64}')format('woff2')}`;
  defs.prepend(style);
}

  const assetCache = new Map<string, string>();
  const svgTextCache = new Map<string, string>();
  for (const [imgIdx, image] of Array.from(svgClone.querySelectorAll("image")).entries()) {
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

    // Inline SVG assets as <g> elements; fall back to base64 for non-SVG or on error.
    if (assetPath.toLowerCase().endsWith(".svg")) {
      try {
        let svgText = svgTextCache.get(assetPath);
        if (!svgText) {
          const response = await fetch(new URL(assetPath, window.location.origin).toString());
          if (!response.ok) throw new Error(`${response.status}`);
          svgText = await response.text();
          svgTextCache.set(assetPath, svgText);
        }

        const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
        const innerSvg = parsed.querySelector("svg");
        if (!innerSvg) throw new Error("no <svg> in fetched file");

        // Build a <g> that positions/sizes the inline SVG to match the <image>'s box
        const ix = Number.parseFloat(image.getAttribute("x") ?? "0");
        const iy = Number.parseFloat(image.getAttribute("y") ?? "0");
        const iw = Number.parseFloat(image.getAttribute("width") ?? "0");
        const ih = Number.parseFloat(image.getAttribute("height") ?? "0");
        const vbRaw = innerSvg.getAttribute("viewBox");
        const vbParts = vbRaw ? vbRaw.trim().split(/[\s,]+/).map(Number) : null;
        const [vbX, vbY, vbW, vbH] = (vbParts?.length === 4 && vbParts.every(Number.isFinite))
          ? vbParts
          : [0, 0, iw || 1, ih || 1];

        const scaleX = iw > 0 ? iw / vbW : 1;
        const scaleY = ih > 0 ? ih / vbH : 1;
        const translateX = ix - vbX * scaleX;
        const translateY = iy - vbY * scaleY;

        const g = svgClone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`);

        // Copy data-* and class attributes from the original <image>
        for (const attr of Array.from(image.attributes)) {
          if (attr.name.startsWith("data-") || attr.name === "class") {
            g.setAttribute(attr.name, attr.value);
          }
        }
        const existingTransform = image.getAttribute("transform");
        if (existingTransform) {
          g.setAttribute("transform", `${existingTransform} translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`);
        }

        // Prefix all IDs and their references to avoid conflicts when multiple
        // copies of the same bubble SVG are inlined into the same document.
        const prefix = `b${imgIdx}-`;
        let prefixedSvgText = new XMLSerializer().serializeToString(innerSvg);
        prefixedSvgText = prefixedSvgText.replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`);
        prefixedSvgText = prefixedSvgText.replace(/\burl\(#([^)]+)\)/g, `url(#${prefix}$1)`);
        prefixedSvgText = prefixedSvgText.replace(/\bxlink:href="#([^"]+)"/g, `xlink:href="#${prefix}$1"`);
        const prefixedInnerSvg = new DOMParser()
          .parseFromString(prefixedSvgText, "image/svg+xml")
          .querySelector("svg") ?? innerSvg;

        for (const child of Array.from(prefixedInnerSvg.childNodes)) {
          g.appendChild(svgClone.ownerDocument.importNode(child, true));
        }

        image.replaceWith(g);
        continue;
      } catch {
        // Fall through to base64 fallback
      }
    }

    const dataUrl = await assetPathToDataUrl(assetPath, assetCache);
    image.setAttribute("href", dataUrl);
    image.setAttribute("xlink:href", dataUrl);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
  }

  svgClone.querySelectorAll("circle.bubble").forEach(el => el.setAttribute("data-link", "https://example.com"));
  const raw = new XMLSerializer().serializeToString(svgClone);
const xml = raw
  .replace(/></g, ">\n<")
  .replace(/(<circle[^>]*)(>)/g, (_, attrs, close) =>
    attrs.replace(/(\s[a-zA-Z:_-]+=)/g, "\n  $1") + close
  );
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
  const [previewKey, setPreviewKey] = useState(0);
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
      setPreviewKey((k) => k + 1);
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
        ? (parsed.documentElement as unknown as SVGSVGElement)
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
        key={previewKey}
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
