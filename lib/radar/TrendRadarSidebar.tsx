"use client";

import { bubbleTypes, TREND_RADAR_UPLOAD_INPUT_ID, type BubbleType } from "@/lib/radar/radarConfig";

type TrendRadarSidebarProps = {
  bubbleEditorDisabled: boolean;
  fileName: string;
  pendingSlotAssignmentCount: number;
  saveEditsNotice: string | null;
  selectedBubble: {
    id: string;
    label: string;
    type: BubbleType | "";
  } | null;
  onBubbleLabelChange: (value: string) => void;
  onBubbleTypeChange: (value: BubbleType) => void;
  onDownloadSvg: () => void;
  onHidePanel: () => void;
  onSaveEdits: () => void;
  onUploadFile: (file: File | null) => void;
};

export function TrendRadarSidebar({
  bubbleEditorDisabled,
  fileName,
  pendingSlotAssignmentCount,
  saveEditsNotice,
  selectedBubble,
  onBubbleLabelChange,
  onBubbleTypeChange,
  onDownloadSvg,
  onHidePanel,
  onSaveEdits,
  onUploadFile,
}: TrendRadarSidebarProps) {
  const displayFont = { fontFamily: "Montserrat, Open Sans, Arial, sans-serif" } as const;
  const selectedBubbleLabel = selectedBubble?.label ?? "";
  const selectedBubbleType = selectedBubble?.type ?? "";

  return (
    <aside className="flex min-h-[780px] flex-col justify-between rounded-[16px] bg-[#fbfbfb] px-8 py-10 shadow-[-3px_0_16px_rgba(0,0,0,0.05)] xl:rounded-l-[16px] xl:rounded-r-none">
      <div className="flex flex-col gap-10">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[#222222]" style={displayFont}>
            Customize map
          </h2>
          <button
            type="button"
            onClick={onHidePanel}
            className="inline-flex items-center justify-center rounded-full border border-[rgba(34,34,34,0.2)] bg-white px-4 py-3 text-[12px] text-[#222222] transition hover:bg-[#f6f6f6]"
            style={displayFont}
          >
            Hide panel
          </button>
        </div>

        <p className="max-w-[314px] text-[14px] leading-[1.2] text-[rgba(34,34,34,0.6)]">
          Upload your unstyled HTML (like trend_radar_KI.html), which will render styled SVG animation.
        </p>

        <div className="flex flex-col gap-4">
          <label className="text-[14px] leading-[1.2] text-[#42424a]" htmlFor={TREND_RADAR_UPLOAD_INPUT_ID}>
            Upload trend radar html
          </label>

          <input
            id={TREND_RADAR_UPLOAD_INPUT_ID}
            type="file"
            accept=".html,text/html"
            className="sr-only"
            onChange={(event) => {
              onUploadFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />

          <div className="flex items-center gap-2 rounded-full border border-[rgba(34,34,34,0.2)] bg-white px-3 py-[9px]">
            <label
              htmlFor={TREND_RADAR_UPLOAD_INPUT_ID}
              className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#222222] px-4 text-[14px] text-white"
              style={displayFont}
            >
              Choose file
            </label>

            <div className="min-w-0 truncate text-[14px] leading-[1.2] text-[#42424a]">
              {fileName || "No file chosen"}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-4">
            <label htmlFor="trend-radar-bubble-label" className="text-[14px] leading-[1.2] text-[#42424a]">
              Bubble label
            </label>
            <input
              id="trend-radar-bubble-label"
              type="text"
              value={selectedBubbleLabel}
              onChange={(event) => onBubbleLabelChange(event.target.value)}
              placeholder={bubbleEditorDisabled ? "Select a bubble to edit" : "Type a bubble label"}
              disabled={bubbleEditorDisabled}
              className="h-10 w-full rounded-full border border-transparent bg-[rgba(0,0,0,0.05)] px-4 text-[14px] text-[#222222] outline-none placeholder:text-[rgba(0,0,0,0.4)] focus:border-[rgba(34,34,34,0.2)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <div className="flex flex-col gap-4">
            <label htmlFor="trend-radar-bubble-type" className="text-[14px] leading-[1.2] text-[#42424a]">
              Bubble type/Kopplungsintensität topic
            </label>
            <div className="relative flex h-[41px] items-center rounded-full bg-[rgba(0,0,0,0.05)] pl-4 pr-10">
              <span className="mr-2 h-4 w-4 shrink-0 rounded-full border border-[#9edbe2] bg-[#c7eef2]" />
              <select
                id="trend-radar-bubble-type"
                value={bubbleEditorDisabled ? "" : selectedBubbleType}
                onChange={(event) => onBubbleTypeChange(event.target.value as BubbleType)}
                disabled={bubbleEditorDisabled}
                className="h-full w-full appearance-none bg-transparent text-[14px] text-[#222222] outline-none disabled:cursor-not-allowed disabled:text-[rgba(0,0,0,0.4)]"
              >
                {bubbleEditorDisabled && <option value="">Select a bubble to change bubble type</option>}
                {bubbleTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#6b6b6b]">
                <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true">
                  <path d="M1 1.5L8 8.5L15 1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSaveEdits}
            disabled={pendingSlotAssignmentCount === 0}
            className="inline-flex items-center justify-center rounded-full border border-[rgba(192,124,17,0.28)] bg-[#fff4dd] px-4 py-3 text-[14px] text-[#7a4b00] disabled:cursor-not-allowed disabled:border-[rgba(34,34,34,0.12)] disabled:bg-[rgba(255,255,255,0.7)] disabled:text-[rgba(34,34,34,0.45)]"
            style={displayFont}
          >
            Save edits
          </button>
          <div className="text-[12px] leading-[1.4] text-[rgba(34,34,34,0.6)]">
            {pendingSlotAssignmentCount > 0
              ? `${pendingSlotAssignmentCount} preview slot edit${pendingSlotAssignmentCount === 1 ? "" : "s"} pending.`
              : "No preview slot edits pending."}
          </div>
          {saveEditsNotice && (
            <div className="text-[12px] leading-[1.4] text-[#7a4b00]">{saveEditsNotice}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDownloadSvg}
            className="inline-flex items-center justify-center rounded-full bg-[#222222] px-4 py-3 text-[14px] text-white"
            style={displayFont}
          >
            Download SVG
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-[rgba(34,34,34,0.2)] bg-white px-4 py-3 text-[14px] text-[#222222]"
            style={displayFont}
          >
            Download full html
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-[rgba(34,34,34,0.2)] bg-white px-4 py-3 text-[14px] text-[#222222]"
            style={displayFont}
          >
            Download WP code
          </button>
        </div>
      </div>
    </aside>
  );
}
