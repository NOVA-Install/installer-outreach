import { PriceTrackerDashboard } from "@/components/price-tracker/dashboard";

export default function PriceTrackerPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Price Tracker</h1>
        <p className="text-[13px] text-[#9a9a9a] mt-0.5">
          Automated price scraping from installer websites
        </p>
      </div>
      <PriceTrackerDashboard />
    </div>
  );
}
