"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function AddInstallerDialog() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const [form, setForm] = useState({
    companyName: "",
    email: "",
    telephone: "",
    website: "",
    address: "",
    county: "",
    postcode: "",
  });

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/installers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create");
      }

      const installer = await res.json();
      toast.success(`${form.companyName} added`);
      setOpen(false);
      setForm({
        companyName: "",
        email: "",
        telephone: "",
        website: "",
        address: "",
        county: "",
        postcode: "",
      });
      router.push(`/installers/${installer.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 h-8 gap-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
        <Plus className="h-4 w-4" />
        Add Installer
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Installer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium">
              Company Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={form.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              placeholder="e.g. ABC Solar Ltd"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="info@example.com"
                type="email"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Telephone</label>
              <Input
                value={form.telephone}
                onChange={(e) => update("telephone", e.target.value)}
                placeholder="01234 567890"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Website</label>
            <Input
              value={form.website}
              onChange={(e) => update("website", e.target.value)}
              placeholder="www.example.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Address</label>
            <Input
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              placeholder="123 High Street"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">County</label>
              <Input
                value={form.county}
                onChange={(e) => update("county", e.target.value)}
                placeholder="e.g. Kent"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Postcode</label>
              <Input
                value={form.postcode}
                onChange={(e) => update("postcode", e.target.value)}
                placeholder="e.g. CT1 2AB"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Add Installer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
