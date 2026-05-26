"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function EnrichGoogleAdsButton({ installerId }: { installerId: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/installers/${installerId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "google_ads" }),
      });
      const data = await res.json();
      if (data.errors?.length > 0) {
        toast.error(data.errors[0]);
      } else {
        toast.success("Google Ads data fetched");
        router.refresh();
      }
    } catch {
      toast.error("Failed to fetch Google Ads data");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4ABDE8] hover:text-[#1a8ab5] transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {loading ? "Fetching..." : "Fetch Google Ads data"}
    </button>
  );
}
