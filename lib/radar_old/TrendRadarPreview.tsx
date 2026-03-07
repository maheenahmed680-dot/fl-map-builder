"use client";

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
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as Element | null;
    const bubble = target?.closest("[data-bubble-id]");
    const bubbleId = bubble?.getAttribute("data-bubble-id") ?? null;
    onSelectBubble(bubbleId);
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

      <div className="rounded-[28px] bg-[#f7f7f4] p-3">
        <div
          className="trend-radar-preview h-[72vh] overflow-hidden rounded-[24px] bg-[#eef0eb]"
          onClick={handleClick}
        >
          <style>{`
            .trend-radar-preview svg{
              width:100%;
              height:100%;
              display:block;
            }
          `}</style>

          {svgMarkup ? (
            <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
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
