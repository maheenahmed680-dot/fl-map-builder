"use client";

import {
  bubbleSymbolIds,
  type BubbleType,
} from "@/lib/radar/radarConfig";

export type RadarBubbleSelection = {
  id: string;
  label: string;
  type: BubbleType;
};

function parseSvg(svgText: string): SVGSVGElement | null {
  if (!svgText.trim()) return null;

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  return parsed.querySelector("svg");
}

function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

function updateSelectedClass(svg: SVGSVGElement, selectedId: string | null) {
  svg.querySelectorAll<SVGGElement>(".tr-bubble, [data-bubble-id]").forEach((bubble) => {
    const bubbleId = bubble.getAttribute("data-bubble-id");
    bubble.classList.toggle("is-selected", Boolean(selectedId) && bubbleId === selectedId);
  });
}

export function readRadarBubbleSelection(svgText: string, bubbleId: string): RadarBubbleSelection | null {
  const svg = parseSvg(svgText);
  if (!svg) return null;

  const bubble = svg.querySelector<SVGGElement>(`[data-bubble-id="${bubbleId}"]`);
  if (!bubble) return null;

  const text = bubble.querySelector<SVGTextElement>(".tr-label");
  const label = text?.textContent ?? "";
  const type = (bubble.getAttribute("data-bubble-type") ?? "Hoch") as BubbleType;

  return { id: bubbleId, label, type };
}

export function readFirstRadarBubbleSelection(svgText: string): RadarBubbleSelection | null {
  const svg = parseSvg(svgText);
  if (!svg) return null;

  const bubble = svg.querySelector<SVGGElement>("[data-bubble-id]");
  if (!bubble) return null;

  const id = bubble.getAttribute("data-bubble-id");
  if (!id) return null;

  const text = bubble.querySelector<SVGTextElement>(".tr-label");
  const label = text?.textContent ?? "";
  const type = (bubble.getAttribute("data-bubble-type") ?? "Hoch") as BubbleType;

  return { id, label, type };
}

export function setRadarBubbleSelection(svgText: string, selectedId: string | null): string {
  const svg = parseSvg(svgText);
  if (!svg) return svgText;

  updateSelectedClass(svg, selectedId);
  return serializeSvg(svg);
}

export function updateRadarBubble(
  svgText: string,
  selection: RadarBubbleSelection,
  selectedId: string | null = selection.id,
): string {
  const svg = parseSvg(svgText);
  if (!svg) return svgText;

  const bubble = svg.querySelector<SVGGElement>(`[data-bubble-id="${selection.id}"]`);
  if (!bubble) return svgText;

  const text = bubble.querySelector<SVGTextElement>(".tr-label");
  const use = bubble.querySelector<SVGUseElement>("use");

  bubble.setAttribute("data-bubble-type", selection.type);

  if (text) {
    text.textContent = selection.label;
  }

  if (use) {
    const href = `#${bubbleSymbolIds[selection.type]}`;
    use.setAttribute("href", href);
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
  }

  updateSelectedClass(svg, selectedId);
  return serializeSvg(svg);
}
