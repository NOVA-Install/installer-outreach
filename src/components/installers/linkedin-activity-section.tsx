"use client";

import { useState } from "react";

export function LinkedInActivityToggle({
  relevantCount,
  totalCount,
  relevantChildren,
  allChildren,
}: {
  relevantCount: number;
  totalCount: number;
  relevantChildren: React.ReactNode;
  allChildren: React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);

  return (
    <div>
      {showAll ? allChildren : relevantChildren}
      {totalCount > relevantCount && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-[#0a66c2] hover:underline mt-3 block"
        >
          {showAll ? `Show relevant only (${relevantCount})` : `Show all ${totalCount} posts`}
        </button>
      )}
    </div>
  );
}
