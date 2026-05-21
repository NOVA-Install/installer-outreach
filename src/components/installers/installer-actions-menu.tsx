"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Sparkles, Merge, MessageSquarePlus, X } from "lucide-react";
import { EnrichSingle } from "./enrich-single";
import { TaskTracker } from "./task-tracker";
import { MergeDialog } from "./merge-dialog";

export function InstallerActionsMenu({
  installerId,
  installerName,
  hasGoogleReviews,
  hasTrustpilotProfile,
  onLogActivity,
}: {
  installerId: number;
  installerName: string;
  hasGoogleReviews: boolean;
  hasTrustpilotProfile: boolean;
  onLogActivity?: () => void;
}) {
  const [showEnrich, setShowEnrich] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {onLogActivity && (
          <Button
            variant="outline"
            size="sm"
            onClick={onLogActivity}
            className="gap-1.5"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Log Activity
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border hover:bg-muted transition-colors">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEnrich(!showEnrich)}>
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              {showEnrich ? "Hide Enrichment" : "Enrich Data"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowMerge(true)}>
              <Merge className="h-3.5 w-3.5 mr-2" />
              Merge Installer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Merge dialog */}
      <MergeDialog
        installerId={installerId}
        installerName={installerName}
        externalOpen={showMerge}
        onExternalClose={() => setShowMerge(false)}
      />

      {/* Enrichment slide-over panel */}
      {showEnrich && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowEnrich(false)} />
          <div className="fixed top-0 right-0 h-full w-[460px] max-w-[90vw] bg-white border-l border-[#e5e5e5] shadow-2xl z-50 overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-[#e5e5e5] px-4 py-3 flex items-center justify-between z-10">
              <span className="text-[13px] font-semibold text-[#1D1D1D]">Enrich Data</span>
              <button onClick={() => setShowEnrich(false)} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[#f0f0f0] transition-colors">
                <X className="h-4 w-4 text-[#6a6a6a]" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <EnrichSingle
                installerId={installerId}
                hasGoogleReviews={hasGoogleReviews}
                hasTrustpilotProfile={hasTrustpilotProfile}
              />
              <TaskTracker installerId={installerId} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
