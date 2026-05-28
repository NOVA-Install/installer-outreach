"use client";

import { useState } from "react";
import { FaLinkedinIn } from "react-icons/fa6";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function LinkedInSearchButton({ installerId }: { installerId: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/installers/${installerId}/linkedin-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postedLimit: "month" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (data.newSignals > 0) {
        toast.success(`Found ${data.newSignals} new post${data.newSignals !== 1 ? "s" : ""} from ${data.companySlug}`);
      } else {
        toast(`No new posts found (${data.postsFound} checked)`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={loading}
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border border-[#0a66c2]/20 bg-[#0a66c2]/5 text-[11px] font-medium text-[#0a66c2] hover:bg-[#0a66c2]/10 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <><Loader2 className="h-3 w-3 animate-spin" /> Searching...</>
      ) : (
        <><FaLinkedinIn className="h-3 w-3" /> Search LinkedIn</>
      )}
    </button>
  );
}
