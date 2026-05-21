"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Loader2, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface CorrectEnrichmentProps {
  installerId: number;
  source: "trustpilot" | "companies_house" | "google";
  currentValue?: string | null;
  label: string;
  placeholder: string;
  helpText?: string;
}

export function CorrectEnrichment({
  installerId,
  source,
  currentValue,
  label,
  placeholder,
  helpText,
}: CorrectEnrichmentProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async () => {
    if (!value.trim()) return;
    setLoading(true);
    try {
      const body: Record<string, string> = { source };
      if (source === "trustpilot") body.domain = value.trim();
      if (source === "companies_house") body.companyNumber = value.trim();
      if (source === "google") body.searchQuery = value.trim();

      const res = await fetch(`/api/installers/${installerId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      setEditing(false);
      setValue("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteData = async () => {
    if (!confirm(`Delete ${label} data for this installer?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/installers/${installerId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, action: "delete" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11px] text-[#9a9a9a] hover:text-[#4ABDE8] transition-colors"
          title={`Correct ${label}`}
        >
          <Pencil className="h-3 w-3" />
          Correct
        </button>
        <button
          onClick={deleteData}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-[#9a9a9a] hover:text-red-500 transition-colors"
          title={`Remove ${label} data`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 pt-1 border-t">
      <p className="text-[11px] font-medium text-[#6a6a6a]">Correct {label}</p>
      {currentValue && (
        <p className="text-[11px] text-[#9a9a9a]">
          Current: <span className="text-[#3a3a3a]">{currentValue}</span>
        </p>
      )}
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-7 text-[12px] flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={loading || !value.trim()}
          className="h-7 px-2 text-[11px] gap-1"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Update
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setEditing(false); setValue(""); }}
          className="h-7 px-2 text-[11px]"
        >
          Cancel
        </Button>
      </div>
      {helpText && <p className="text-[10px] text-[#9a9a9a]">{helpText}</p>}
    </div>
  );
}
