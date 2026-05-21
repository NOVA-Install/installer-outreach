"use client";

import { useState } from "react";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function PipelineStageSelector({
  installerId,
  currentStage,
}: {
  installerId: number;
  currentStage: string | null;
}) {
  const [stage, setStage] = useState(currentStage || "uncontacted");
  const [updating, setUpdating] = useState(false);

  const handleStageChange = async (newStage: PipelineStage) => {
    if (newStage === stage || updating) return;
    const oldStage = stage;
    setStage(newStage);
    setUpdating(true);

    try {
      const res = await fetch(`/api/installers/${installerId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });

      if (!res.ok) throw new Error("Failed to update");
      toast.success(`Moved to ${PIPELINE_STAGES.find((s) => s.key === newStage)?.label}`);
    } catch {
      setStage(oldStage);
      toast.error("Failed to update stage");
    } finally {
      setUpdating(false);
    }
  };

  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-[0.06em]">
        Pipeline Stage
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        {PIPELINE_STAGES.map((s, i) => {
          const isActive = s.key === stage;
          const isPast = i < currentIndex;

          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <div className={cn(
                  "w-4 h-px",
                  isPast ? "bg-[#d0d0d0]" : "bg-[#ebebeb]"
                )} />
              )}
              <button
                onClick={() => handleStageChange(s.key)}
                disabled={updating}
                className={cn(
                  "relative px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200 whitespace-nowrap",
                  isActive
                    ? "text-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                    : isPast
                      ? "bg-[#f0f0f0] text-[#6a6a6a] hover:bg-[#e8e8e8]"
                      : "text-[#b0b0b0] hover:bg-[#f5f5f5] hover:text-[#6a6a6a]"
                )}
                style={isActive ? { backgroundColor: s.color } : undefined}
              >
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
