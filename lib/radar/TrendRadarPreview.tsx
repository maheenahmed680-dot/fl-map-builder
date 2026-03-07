"use client";

import { useEffect, useState } from "react";

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

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  useEffect(() => {
    setZoom(1);
  }, [svgMarkup]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
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
          className="trend-radar-preview trend-preview-scroll h-[72vh] overflow-y-auto overflow-x-hidden rounded-[24px] bg-[#ffffff]"
          onClick={handleClick}
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
            }
            .trend-radar-preview .trend-radar-stage{
              display:flex;
              justify-content:center;
              width:100%;
            }
            .trend-preview-zoom{
              display:inline-block;
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
                <button type="button" onClick={(event) => { event.stopPropagation(); handleZoomIn(); }} aria-label="Zoom in">
                  <svg className="zoom-icon" viewBox="0 0 24 24">
  <path d="/Users/apple/Desktop/fl-map-builder/public/zoom-plus.svg" fill="currentColor"/>
</svg>
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); handleZoomOut(); }} aria-label="Zoom out">
                  <img src="/zoom-minus.svg" alt="" />
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); handleZoomReset(); }} aria-label="Reset zoom">
                  <span className="text-lg leading-none text-[#222]">↺</span>
                </button>
              </div>

              <div className="trend-radar-stage">
                <div
                  className="trend-preview-zoom"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
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
