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
import { MoreHorizontal, Sparkles, Merge, MessageSquarePlus } from "lucide-react";
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

      {showEnrich && (
        <div className="space-y-4 mt-4">
          <EnrichSingle
            installerId={installerId}
            hasGoogleReviews={hasGoogleReviews}
            hasTrustpilotProfile={hasTrustpilotProfile}
          />
          <TaskTracker installerId={installerId} />
        </div>
      )}
    </>
  );
}
