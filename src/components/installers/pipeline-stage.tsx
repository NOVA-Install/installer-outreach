"use client";

import { useState, useRef, useEffect } from "react";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

export function PipelineStageSelector({
  installerId,
  currentStage,
}: {
  installerId: number;
  currentStage: string | null;
}) {
  const [stage, setStage] = useState(currentStage || "uncontacted");
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleStageChange = async (newStage: PipelineStage) => {
    if (newStage === stage || updating) return;
    setOpen(false);
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

  const current = PIPELINE_STAGES.find((s) => s.key === stage);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={updating}
        className="inline-flex items-center gap-2 rounded-lg border border-[#e8e8e8] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3a3a3a] hover:border-[#d0d0d0] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200"
      >
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: current?.color || "#9a9a9a" }}
        />
        {current?.label || "Uncontacted"}
        <ChevronDown className={cn("h-3 w-3 text-[#9a9a9a] transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[180px] rounded-xl border border-[#ebebeb] bg-white py-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
          {PIPELINE_STAGES.map((s) => (
            <button
              key={s.key}
              onClick={() => handleStageChange(s.key)}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-left transition-colors",
                s.key === stage
                  ? "bg-[#f5f5f5] font-medium text-[#1D1D1D]"
                  : "text-[#6a6a6a] hover:bg-[#fafafa] hover:text-[#1D1D1D]"
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
