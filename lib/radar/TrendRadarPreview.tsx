"use client";

import { useEffect, useRef, useState } from "react";

type TrendRadarPreviewProps = {
  onSelectBubble: (bubbleId: string | null) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  svgMarkup: string;
  warnings: string[];
};

export function TrendRadarPreview({
  onSelectBubble,
  onToggleSidebar,
  sidebarOpen,
  svgMarkup,
  warnings,
}: TrendRadarPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setZoom(1);
      setTranslateX(0);
      setTranslateY(0);
      setIsDragging(false);
      isDraggingRef.current = false;
      suppressClickRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [svgMarkup]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }

    const target = event.target as Element | null;
    const bubble = target?.closest("[data-bubble-id]");
    const bubbleId = bubble?.getAttribute("data-bubble-id") ?? null;
    onSelectBubble(bubbleId);
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
    event.preventDefault();
    suppressClickRef.current = false;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      tx: translateX,
      ty: translateY,
    };
    isDraggingRef.current = true;
    setIsDragging(true);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    event.preventDefault();

    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;

    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      suppressClickRef.current = true;
    }

    setTranslateX(dragStartRef.current.tx + deltaX);
    setTranslateY(dragStartRef.current.ty + deltaY);
  }

  function endDragging(event?: React.MouseEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    event?.preventDefault();
    isDraggingRef.current = false;
    setIsDragging(false);
  }

  return (
    <section className="min-w-0 rounded-[32px] bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
      {!sidebarOpen && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="rounded-full border border-[#c9c9c9] bg-white px-5 py-3 text-sm font-semibold text-[#333] transition hover:bg-[#f5f5f3]"
          >
            Show panel
          </button>
        </div>
      )}

      <div className="rounded-[28px] bg-[#f4f4f4] p-3">
        <div
          className={`trend-radar-preview trend-preview-scroll h-[72vh] overflow-hidden rounded-[24px] bg-[#ffffff] ${
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
              display:flex;
              justify-content:center;
              align-items:flex-start;
              position:relative;
              user-select:none;
              cursor:grab;
            }
            .trend-preview-scroll.is-dragging{
              cursor:grabbing;
            }
            .trend-radar-preview .trend-radar-stage{
              display:flex;
              justify-content:center;
              width:100%;
              min-height:100%;
              overflow:hidden;
            }
            .trend-preview-zoom{
              display:inline-block;
              will-change:transform;
            }
            .trend-preview-svg{
              width:100%;
              max-width:100%;
            }
            .trend-preview-svg svg{
              width:100%;
              max-width:100%;
              height:auto;
              display:block;
            }
            .trend-preview-zoomControls{
              position:absolute;
              right:16px;
              top:50%;
              transform:translateY(-50%);
              display:flex;
              flex-direction:column;
              gap:10px;
              z-index:5;
            }
            .trend-preview-zoomControls button{
              width:40px;
              height:40px;
              border-radius:999px;
              background:#fff;
              border:1px solid rgba(0,0,0,0.08);
              box-shadow:0 6px 18px rgba(0,0,0,0.08);
              display:flex;
              align-items:center;
              justify-content:center;
              cursor:pointer;
            }
            .trend-preview-zoomControls img{
              width:18px;
              height:18px;
              display:block;
            }
            .trend-preview-zoomControls button:active{
              transform:scale(0.98);
            }
          `}</style>

          {svgMarkup ? (
            <>
              <div className="trend-preview-zoomControls">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); handleZoomIn(); }}
                  onMouseDown={(event) => event.stopPropagation()}
                  aria-label="Zoom in"
                >
                  <svg className="zoom-icon" viewBox="0 0 24 24">
  <path d="/Users/apple/Desktop/fl-map-builder/public/zoom-plus.svg" fill="currentColor"/>
</svg>
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); handleZoomOut(); }}
                  onMouseDown={(event) => event.stopPropagation()}
                  aria-label="Zoom out"
                >
                  <img src="/zoom-minus.svg" alt="" />
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); handleZoomReset(); }}
                  onMouseDown={(event) => event.stopPropagation()}
                  aria-label="Reset zoom"
                >
                  <span className="text-lg leading-none text-[#222]">↺</span>
                </button>
              </div>

              <div className="trend-radar-stage">
                <div
                  className="trend-preview-zoom"
                  style={{
                    transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
                    transformOrigin: "top center",
                  }}
                >
                  <div className="trend-preview-svg" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm leading-6 text-[#7b7b7b]">
              Upload a trend radar HTML file to render the styled SVG preview.
            </div>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded-[24px] border border-[#ead8b6] bg-[#fff7e9] px-5 py-4 text-sm text-[#77591c]">
          <div className="font-semibold text-[#5c4413]">Warnings</div>
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
