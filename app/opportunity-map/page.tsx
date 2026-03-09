"use client";

import { useState } from "react";
import { OpportunityMapWorkspace } from "@/components/opportunity-map/OpportunityMapWorkspace";
import { TrendRadarWorkspace } from "@/lib/radar/TrendRadarWorkspace";

type BuilderTab = "opportunity-map" | "trend-radar";

const tabs: Array<{ id: BuilderTab; label: string }> = [
  { id: "opportunity-map", label: "Opportunity Map" },
  { id: "trend-radar", label: "Trend Radar" },
];

export default function OpportunityMapPage() {
  const [activeTab, setActiveTab] = useState<BuilderTab>("trend-radar");
  const isTrendRadar = activeTab === "trend-radar";
  const displayFont = { fontFamily: "Montserrat, Open Sans, Arial, sans-serif" } as const;

  return (
    <div className={`min-h-screen ${isTrendRadar ? "bg-[#ededed] text-[#222222]" : "bg-white text-gray-900"}`}>
      {isTrendRadar ? (
        <div className="mx-auto max-w-[1520px] px-6 py-8 lg:px-8">
          <header className="mb-8 flex items-center justify-between gap-6">
            <div className="inline-flex items-center gap-1 rounded-full bg-[#f6f6f6] p-1 shadow-[2px_2px_4px_rgba(0,0,0,0.1)]">
              {tabs.map((tab) => {
                const tabActive = tab.id === activeTab;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-4 py-2 text-[12px] leading-none transition ${
                      tabActive ? "bg-[#222222] text-white" : "text-[rgba(34,34,34,0.6)] hover:text-[#222222]"
                    }`}
                    style={displayFont}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="inline-flex items-center gap-1 rounded-full bg-[#f6f6f6] p-1 shadow-[2px_2px_4px_rgba(0,0,0,0.1)]">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#222222] text-[12px] text-white"
                style={displayFont}
              >
                EN
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-[12px] text-[rgba(34,34,34,0.45)]"
                style={displayFont}
              >
                DE
              </button>
            </div>
          </header>

          <TrendRadarWorkspace />
        </div>
      ) : (
        <div className="mx-auto max-w-[1800px] px-6 py-8">
          <div className="mb-8 flex justify-center">
            <div className="inline-flex rounded-full bg-[#ededed] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
              {tabs.map((tab) => {
                const tabActive = tab.id === activeTab;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-6 py-3 text-[15px] font-semibold transition ${
                      tabActive ? "bg-[#1f1f1f] text-white" : "text-[#7a7a7a] hover:text-[#2a2a2a]"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <OpportunityMapWorkspace />
        </div>
      )}
    </div>
  );
}
