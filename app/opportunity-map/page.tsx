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
  const [activeTab, setActiveTab] = useState<BuilderTab>("opportunity-map");

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-[1800px] px-6 py-8">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full bg-[#ededed] p-1 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-6 py-3 text-[15px] font-semibold transition ${
                    isActive ? "bg-[#1f1f1f] text-white" : "text-[#7a7a7a] hover:text-[#2a2a2a]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "opportunity-map" ? <OpportunityMapWorkspace /> : <TrendRadarWorkspace />}
      </div>
    </div>
  );
}
