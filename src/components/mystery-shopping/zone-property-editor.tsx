"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { UK_ZONES } from "@/lib/constants";

interface ZoneProperty {
  id: number;
  zoneId: string;
  address: string;
  postcode: string;
  details: string | null;
  updatedAt: string;
}

interface PropertyDetails {
  propertyType?: string;
  bedrooms?: number;
  roofOrientation?: string;
  roofType?: string;
  annualElectricityUsage?: number;
  currentElectricityBill?: number;
  [key: string]: unknown;
}

const PROPERTY_TYPES = ["detached", "semi-detached", "terraced", "bungalow", "flat"];
const ROOF_ORIENTATIONS = ["south", "south-east", "south-west", "east", "west"];
const ROOF_TYPES = ["pitched", "flat"];

export function ZonePropertyEditor() {
  const [properties, setProperties] = useState<ZoneProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Form state per zone
  const [forms, setForms] = useState<Record<string, {
    address: string;
    postcode: string;
    details: PropertyDetails;
  }>>({});

  const fetchProperties = useCallback(async () => {
    const res = await fetch("/api/mystery-shopping/zone-properties");
    const data = await res.json();
    setProperties(data);

    // Initialise form state from existing data
    const formState: typeof forms = {};
    for (const prop of data) {
      formState[prop.zoneId] = {
        address: prop.address,
        postcode: prop.postcode,
        details: prop.details ? JSON.parse(prop.details) : {},
      };
    }
    setForms(formState);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const getForm = (zoneId: string) => {
    return forms[zoneId] || { address: "", postcode: "", details: {} };
  };

  const updateForm = (zoneId: string, updates: Partial<typeof forms[string]>) => {
    setForms((prev) => ({
      ...prev,
      [zoneId]: { ...getForm(zoneId), ...updates },
    }));
  };

  const updateDetails = (zoneId: string, key: string, value: unknown) => {
    const form = getForm(zoneId);
    setForms((prev) => ({
      ...prev,
      [zoneId]: {
        ...form,
        details: { ...form.details, [key]: value },
      },
    }));
  };

  const saveZone = async (zoneId: string) => {
    const form = getForm(zoneId);
    if (!form.address || !form.postcode) {
      toast.error("Address and postcode are required");
      return;
    }

    setSaving(zoneId);
    try {
      const res = await fetch("/api/mystery-shopping/zone-properties", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneId,
          address: form.address,
          postcode: form.postcode,
          details: form.details,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success(`Saved property for ${UK_ZONES.find((z) => z.id === zoneId)?.name || zoneId}`);
      fetchProperties();
    } catch {
      toast.error("Failed to save property");
    } finally {
      setSaving(null);
    }
  };

  const configuredZones = new Set(properties.map((p) => p.zoneId));

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="text-[13px] text-[#9a9a9a]">
        {configuredZones.size} of {UK_ZONES.length} zones configured
      </div>

      {UK_ZONES.map((zone) => {
        const isConfigured = configuredZones.has(zone.id);
        const isExpanded = expandedZone === zone.id;
        const form = getForm(zone.id);

        return (
          <Card key={zone.id}>
            <CardHeader
              className="pb-2 cursor-pointer"
              onClick={() => setExpandedZone(isExpanded ? null : zone.id)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-[13px] font-medium flex items-center gap-2">
                  {zone.name}
                  {isConfigured && (
                    <Badge variant="secondary" className="bg-green-100 text-green-700 text-[11px]">
                      <Check className="h-3 w-3 mr-0.5" />
                      Configured
                    </Badge>
                  )}
                </CardTitle>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-[#9a9a9a]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[#9a9a9a]" />
                )}
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Address</label>
                    <Input
                      value={form.address}
                      onChange={(e) => updateForm(zone.id, { address: e.target.value })}
                      placeholder="123 Example Street, Town"
                      className="mt-1 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Postcode</label>
                    <Input
                      value={form.postcode}
                      onChange={(e) => updateForm(zone.id, { postcode: e.target.value })}
                      placeholder="SW1A 1AA"
                      className="mt-1 text-[13px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Property Type</label>
                    <Select
                      value={form.details.propertyType || ""}
                      onValueChange={(v) => updateDetails(zone.id, "propertyType", v)}
                    >
                      <SelectTrigger className="mt-1 text-[13px]">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {PROPERTY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Bedrooms</label>
                    <Input
                      type="number"
                      value={form.details.bedrooms || ""}
                      onChange={(e) => updateDetails(zone.id, "bedrooms", Number(e.target.value) || undefined)}
                      placeholder="3"
                      className="mt-1 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Roof Orientation</label>
                    <Select
                      value={form.details.roofOrientation || ""}
                      onValueChange={(v) => updateDetails(zone.id, "roofOrientation", v)}
                    >
                      <SelectTrigger className="mt-1 text-[13px]">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOF_ORIENTATIONS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o.charAt(0).toUpperCase() + o.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Roof Type</label>
                    <Select
                      value={form.details.roofType || ""}
                      onValueChange={(v) => updateDetails(zone.id, "roofType", v)}
                    >
                      <SelectTrigger className="mt-1 text-[13px]">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOF_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Annual Usage (kWh)</label>
                    <Input
                      type="number"
                      value={form.details.annualElectricityUsage || ""}
                      onChange={(e) => updateDetails(zone.id, "annualElectricityUsage", Number(e.target.value) || undefined)}
                      placeholder="3500"
                      className="mt-1 text-[13px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#9a9a9a]">Electricity Bill (£/year)</label>
                    <Input
                      type="number"
                      value={form.details.currentElectricityBill || ""}
                      onChange={(e) => updateDetails(zone.id, "currentElectricityBill", Number(e.target.value) || undefined)}
                      placeholder="1200"
                      className="mt-1 text-[13px]"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => saveZone(zone.id)}
                    disabled={saving === zone.id || !form.address || !form.postcode}
                  >
                    {saving === zone.id ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
