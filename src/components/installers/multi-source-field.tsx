"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Star as StarIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface SourceValue {
  value: string;
  source: string;
}

const SOURCE_COLORS: Record<string, string> = {
  MCS: "bg-blue-50 text-blue-700 border-blue-200",
  Nova: "bg-purple-50 text-purple-700 border-purple-200",
  TrustMark: "bg-green-50 text-green-700 border-green-200",
};

export function MultiSourceField({
  label,
  primaryValue,
  sources,
  installerId,
  field,
}: {
  label: string;
  primaryValue: string | null;
  sources: string | null; // JSON string
  installerId: number;
  field: string; // "website" | "email" | "telephone" | "address"
}) {
  const [updating, setUpdating] = useState(false);
  const router = useRouter();

  const parsed: SourceValue[] = sources ? JSON.parse(sources) : [];

  // Deduplicate by value
  const unique = parsed.filter(
    (item, index, arr) =>
      arr.findIndex((a) => a.value.toLowerCase() === item.value.toLowerCase()) === index
  );

  if (unique.length <= 1) return null; // Only show when there are multiple

  const setPrimary = async (value: string) => {
    if (value === primaryValue) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/installers/${installerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success(`Primary ${label.toLowerCase()} updated`);
      router.refresh();
    } catch {
      toast.error("Failed to update");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label} (from {unique.length} sources)</p>
      <div className="space-y-1">
        {unique.map((item) => {
          const isPrimary = item.value.toLowerCase() === primaryValue?.toLowerCase();
          return (
            <div
              key={`${item.value}-${item.source}`}
              className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm ${
                isPrimary ? "border-primary/30 bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isPrimary && (
                  <StarIcon className="h-3 w-3 text-primary fill-primary shrink-0" />
                )}
                <span className={`truncate ${isPrimary ? "font-medium" : ""}`}>
                  {item.value}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${SOURCE_COLORS[item.source] || ""}`}
                >
                  {item.source}
                </Badge>
              </div>
              {!isPrimary && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrimary(item.value)}
                  disabled={updating}
                  className="h-6 text-[10px] shrink-0 ml-2"
                >
                  <Check className="h-3 w-3 mr-0.5" />
                  Set primary
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
