"use client";

import { bubbleTypes, TREND_RADAR_UPLOAD_INPUT_ID, type BubbleType } from "@/lib/radar/radarConfig";

type TrendRadarSidebarProps = {
  bubbleLabel: string;
  bubbleType: BubbleType;
  fileName: string;
  hasSelection: boolean;
  onBubbleLabelChange: (value: string) => void;
  onBubbleTypeChange: (value: BubbleType) => void;
  onHidePanel: () => void;
  onUploadFile: (file: File | null) => void;
};

export function TrendRadarSidebar({
  bubbleLabel,
  bubbleType,
  fileName,
  hasSelection,
  onBubbleLabelChange,
  onBubbleTypeChange,
  onHidePanel,
  onUploadFile,
}: TrendRadarSidebarProps) {
  return (
    <aside className="rounded-[32px] bg-[#f3f3f1] p-10 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-[#202020]">Customize map</h2>
        <button
          type="button"
          onClick={onHidePanel}
          className="rounded-full border border-[#c9c9c9] bg-transparent px-5 py-3 text-sm font-semibold text-[#333] transition hover:bg-white"
        >
          Hide panel
        </button>
      </div>

      <p className="mt-12 text-sm leading-6 text-[#7d7d7d]">
        Upload your unstyled HTML (like{" "}
        <code className="rounded bg-white px-1 py-0.5 text-[#4c4c4c]">trend_radar_KI.html</code>), which will render styled
        SVG animation.
      </p>

      <div className="mt-12">
        <label className="mb-4 block text-sm font-medium text-[#4a4a4a]" htmlFor={TREND_RADAR_UPLOAD_INPUT_ID}>
          Upload trend radar html
        </label>
        <div className="rounded-[28px] border border-[#d8d8d8] bg-white p-4">
          <input
            id={TREND_RADAR_UPLOAD_INPUT_ID}
            type="file"
            accept=".html,text/html"
            className="block w-full text-sm text-[#575757] file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-[#1f1f1f] file:px-5 file:py-3 file:text-sm file:font-semibold file:text-white hover:file:bg-black"
            onChange={(event) => {
              onUploadFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <div className="mt-3 text-xs text-[#8c8c8c]">{fileName || "No file chosen"}</div>
        </div>
      </div>

      <div className="mt-12">
        <label htmlFor="trend-radar-bubble-label" className="mb-4 block text-sm font-medium text-[#4a4a4a]">
          Bubble label
        </label>
        <input
          id="trend-radar-bubble-label"
          type="text"
          value={bubbleLabel}
          onChange={(event) => onBubbleLabelChange(event.target.value)}
          placeholder={hasSelection ? "Type a bubble label" : "Select a bubble in the preview"}
          disabled={!hasSelection}
          className="w-full rounded-full border border-transparent bg-[#dededd] px-5 py-4 text-sm text-[#2b2b2b] outline-none placeholder:text-[#8e8e8e] focus:border-[#c9c9c9] focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>

      <div className="mt-12">
        <label htmlFor="trend-radar-bubble-type" className="mb-4 block text-sm font-medium text-[#4a4a4a]">
          Bubble type/Kopplungsintensitat topic
        </label>
        <div className="relative">
          <select
            id="trend-radar-bubble-type"
            value={bubbleType}
            onChange={(event) => onBubbleTypeChange(event.target.value as BubbleType)}
            disabled={!hasSelection}
            className="w-full appearance-none rounded-full border border-transparent bg-[#dededd] px-5 py-4 pr-14 text-sm text-[#2b2b2b] outline-none focus:border-[#c9c9c9] focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {bubbleTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-[#6f6f6f]">
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true">
              <path d="M1 1.5L8 8.5L15 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </div>
      </div>
    </aside>
  );
}
