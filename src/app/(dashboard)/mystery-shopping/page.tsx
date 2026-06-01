import { CampaignList } from "@/components/mystery-shopping/campaign-list";

export default function MysteryShoppingPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Mystery Shopping</h1>
        <p className="text-[13px] text-[#9a9a9a] mt-0.5">
          Benchmark installer quotes across zones
        </p>
      </div>
      <CampaignList />
    </div>
  );
}
