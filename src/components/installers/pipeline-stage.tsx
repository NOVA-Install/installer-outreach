"use client";

import { useState } from "react";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";

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
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Pipeline Stage
      </p>
      <div className="flex items-center gap-0.5 flex-wrap">
        {PIPELINE_STAGES.map((s, i) => {
          const isActive = s.key === stage;
          const isPast = i < currentIndex;
          const stageColor = s.color;

          return (
            <div key={s.key} className="flex items-center">
              {i > 0 && (
                <ChevronRight
                  className={cn(
                    "h-3 w-3 mx-0.5 shrink-0",
                    isPast ? "text-foreground/30" : "text-foreground/10"
                  )}
                />
              )}
              <button
                onClick={() => handleStageChange(s.key)}
                disabled={updating}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "text-white shadow-sm"
                    : isPast
                      ? "bg-muted/80 text-foreground/60 hover:bg-muted"
                      : "bg-transparent text-foreground/40 hover:bg-muted/60 hover:text-foreground/60"
                )}
                style={isActive ? { backgroundColor: stageColor } : undefined}
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
