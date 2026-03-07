"use client";

import { useEffect, useState } from "react";
import { TrendRadarPreview } from "@/lib/radar/TrendRadarPreview";
import { TrendRadarSidebar } from "@/lib/radar/TrendRadarSidebar";
import {
  bubbleAssetUrls,
  bubbleBucketTypeMap,
  type BubbleAssetMap,
  type BubbleOverride,
  type BubbleType,
} from "@/lib/radar/radarConfig";
import { transformTrendRadarHtmlToStyledSvg } from "@/lib/radar/transformTrendRadarHtml";

type BubbleMeta = {
  id: string;
  label: string;
  type: BubbleType;
};

const emptyAssets: BubbleAssetMap = {
  "Sehr hoch": "",
  Hoch: "",
  Niedrig: "",
  "Sehr niedrig": "",
};

export function TrendRadarWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bubbleAssets, setBubbleAssets] = useState<BubbleAssetMap>(emptyAssets);
  const [logoAsset, setLogoAsset] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [fileName, setFileName] = useState("");
  const [svgMarkup, setSvgMarkup] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [bubbles, setBubbles] = useState<Record<string, BubbleMeta>>({});
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, BubbleOverride>>({});

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
        setSvgMarkup("");
        setWarnings([]);
        setBubbles({});
        setSelectedBubbleId(null);
        return;
      }

      const result = await transformTrendRadarHtmlToStyledSvg(rawHtml, {
        bubbleAssets,
        logoAsset,
        overrides,
        selectedBubbleId,
      });

      if (!active) return;

      setSvgMarkup(result.svg);
      setWarnings(result.warnings);

      const nextBubbles = result.bubbles.reduce<Record<string, BubbleMeta>>((acc, bubble) => {
        acc[bubble.id] = bubble;
        return acc;
      }, {});

      setBubbles(nextBubbles);

      if (selectedBubbleId && nextBubbles[selectedBubbleId]) return;

      const firstBubbleId = result.bubbles[0]?.id ?? null;
      setSelectedBubbleId(firstBubbleId);
    }

    void runTransform();

    return () => {
      active = false;
    };
  }, [bubbleAssets, logoAsset, overrides, rawHtml, selectedBubbleId]);

  async function handleUploadFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setRawHtml(text);
    setOverrides({});
    setSelectedBubbleId(null);
  }

  const selectedBubble = selectedBubbleId ? bubbles[selectedBubbleId] ?? null : null;

  function handleBubbleLabelChange(label: string) {
    if (!selectedBubbleId) return;
    setOverrides((current) => ({
      ...current,
      [selectedBubbleId]: {
        ...current[selectedBubbleId],
        label,
      },
    }));
  }

  function handleBubbleTypeChange(type: BubbleType) {
    if (!selectedBubbleId) return;
    setOverrides((current) => ({
      ...current,
      [selectedBubbleId]: {
        ...current[selectedBubbleId],
        type,
      },
    }));
  }

  return (
    <div
      className={
        sidebarOpen
          ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]"
          : "grid grid-cols-1 gap-6"
      }
    >
      <TrendRadarPreview
        onSelectBubble={setSelectedBubbleId}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        sidebarOpen={sidebarOpen}
        svgMarkup={svgMarkup}
        warnings={warnings}
      />

      {sidebarOpen && (
        <TrendRadarSidebar
          bubbleLabel={selectedBubble?.label ?? ""}
          bubbleType={selectedBubble?.type ?? bubbleBucketTypeMap["2"]}
          fileName={fileName}
          hasSelection={Boolean(selectedBubble)}
          onBubbleLabelChange={handleBubbleLabelChange}
          onBubbleTypeChange={handleBubbleTypeChange}
          onHidePanel={() => setSidebarOpen(false)}
          onUploadFile={handleUploadFile}
        />
      )}
    </div>
  );
}
