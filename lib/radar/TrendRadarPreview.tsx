"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type TrendRadarPreviewProps = {
  onBubbleSelect: (selectionKey: string | null) => void;
  onToggleSidebar: () => void;
  selectedBubbleKey: string | null;
  sidebarOpen: boolean;
  svgMarkup: string;
  warnings: string[];
};

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
  return target?.closest("circle.bubble, image.bubble, #radar-labels-outer text") ?? null;
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

  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const previewSvgRef = useRef<HTMLDivElement | null>(null);

  const displayFont = { fontFamily: "Montserrat, Open Sans, Arial, sans-serif" } as const;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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

  useEffect(() => {
    const svg = previewSvgRef.current?.querySelector("svg");
    if (!svg) return;

    svg.querySelectorAll(".is-selected-bubble").forEach((node) => node.classList.remove("is-selected-bubble"));
    svg.querySelectorAll(".is-selected-label").forEach((node) => node.classList.remove("is-selected-label"));
    svg.querySelectorAll(".is-selected-connector").forEach((node) => node.classList.remove("is-selected-connector"));

    const { clusterId: selectedClusterId, trend: selectedTrend } = parseSelectedBubbleKey(selectedBubbleKey);
    if (!selectedClusterId && !selectedTrend) return;

    const bubbleNodes = Array.from(svg.querySelectorAll<SVGElement>("circle.bubble, image.bubble"));
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

    const connectorsByAttribute = connectorNodes.filter((node) =>
      matchesSelectedNode(node, selectedClusterId, selectedTrend),
    );
    if (connectorsByAttribute.length > 0) {
      connectorsByAttribute.forEach((node) => node.classList.add("is-selected-connector"));
      return;
    }

    const selectedBubbleCircle = Array.from(svg.querySelectorAll<SVGCircleElement>("circle.bubble")).find((node) =>
      matchesSelectedNode(node, selectedClusterId, selectedTrend),
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

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }

    const target = event.target as Element | null;
    const selectableNode = getSelectableNode(target);
    if (!selectableNode) {
      onBubbleSelect(null);
      return;
    }

    const clusterId = normalizeSvgValue(selectableNode.getAttribute("data-cluster-id"));
    const trend = normalizeSvgValue(selectableNode.getAttribute("data-trend"));
    onBubbleSelect(toBubbleSelectionKey(clusterId, trend));
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

    const selectableNode = getSelectableNode(event.target as Element | null);
    if (selectableNode) {
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
          .trend-preview-svg svg image.bubble,
          .trend-preview-svg svg #radar-labels-outer text{
            cursor:pointer;
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
          .trend-preview-svg svg circle.bubble.is-selected-bubble{
            stroke:#77acff;
            stroke-width:4;
            stroke-opacity:0.92;
            filter:drop-shadow(0 0 8px rgba(119,172,255,0.35));
          }
          .trend-preview-svg svg image.bubble.is-selected-bubble{
            filter:drop-shadow(0 0 6px rgba(119,172,255,0.44)) drop-shadow(0 0 14px rgba(119,172,255,0.24));
          }
          .trend-preview-svg svg #radar-connectors path.is-selected-connector,
          .trend-preview-svg svg #radar-connectors line.is-selected-connector,
          .trend-preview-svg svg #radar-connectors polyline.is-selected-connector{
            stroke:#77acff !important;
            stroke-width:1.35 !important;
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
                  ref={previewSvgRef}
                  className="trend-preview-svg"
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
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
