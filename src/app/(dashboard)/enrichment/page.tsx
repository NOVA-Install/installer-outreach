import { EnrichmentPanel } from "@/components/enrichment/enrichment-panel";

export default function EnrichmentPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Data Enrichment</h1>
        <p className="text-[13px] text-[#9a9a9a] mt-0.5">
          Enrich your installer data from external sources
        </p>
      </div>
      <EnrichmentPanel />
    </div>
  );
}
