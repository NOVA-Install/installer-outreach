"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function AddFieldInline({
  installerId,
  field,
  label,
  icon,
  placeholder,
}: {
  installerId: number;
  field: string;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    if (!value.trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/installers/${installerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value.trim() }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${label} added`);
      setEditing(false);
      setValue("");
      router.refresh();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1 h-[28px] rounded-lg border border-[#4ABDE8] bg-white overflow-hidden">
        <span className="pl-2.5 text-[#9a9a9a]">{icon}</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setValue(""); } }}
          placeholder={placeholder}
          disabled={saving}
          className="h-full w-[160px] border-0 bg-transparent px-1.5 text-[12px] text-[#1D1D1D] outline-none placeholder:text-[#c5c5c5]"
        />
        <button onClick={save} disabled={saving || !value.trim()} className="h-full px-1.5 text-[#4ABDE8] hover:bg-[#4ABDE8]/10 transition-colors disabled:opacity-30">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
        <button onClick={() => { setEditing(false); setValue(""); }} className="h-full px-1.5 text-[#9a9a9a] hover:bg-[#f0f0f0] transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-lg border border-dashed border-[#d5d5d5] text-[12px] text-[#9a9a9a] hover:border-[#4ABDE8] hover:text-[#4ABDE8] transition-colors"
    >
      <Plus className="h-3 w-3" />
      Add {label}
    </button>
  );
}
