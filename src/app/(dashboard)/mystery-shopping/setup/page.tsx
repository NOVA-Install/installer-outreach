import { ZonePropertyEditor } from "@/components/mystery-shopping/zone-property-editor";

export default function MysteryShoppingSetupPage() {
  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Mystery Shopping Setup</h1>
        <p className="text-[13px] text-[#9a9a9a] mt-0.5">
          Configure reference properties for each zone
        </p>
      </div>
      <ZonePropertyEditor />
    </div>
  );
}
