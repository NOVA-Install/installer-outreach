"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function ShortlistButton({ installerId, initialValue }: { installerId: number; initialValue: boolean }) {
  const [isShortlisted, setIsShortlisted] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const toggle = async () => {
    const newVal = !isShortlisted;
    setIsShortlisted(newVal);
    setSaving(true);
    try {
      const res = await fetch(`/api/installers/${installerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isShortlisted: newVal }),
      });
      if (!res.ok) throw new Error();
      toast.success(newVal ? "Added to shortlist" : "Removed from shortlist");
      router.refresh();
    } catch {
      setIsShortlisted(!newVal);
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={saving}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium transition-colors ${
        isShortlisted
          ? "border-[#4ABDE8] bg-[#4ABDE8]/10 text-[#4ABDE8]"
          : "border-[#e5e5e5] bg-white text-[#6a6a6a] hover:border-[#4ABDE8] hover:text-[#4ABDE8]"
      }`}
    >
      <Star className={`h-3.5 w-3.5 ${isShortlisted ? "fill-[#4ABDE8]" : ""}`} />
      {isShortlisted ? "Shortlisted" : "Shortlist"}
    </button>
  );
}
