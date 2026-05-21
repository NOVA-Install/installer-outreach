import { ImportWizard } from "@/components/import/import-wizard";

export default function ImportPage() {
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Import Data</h1>
        <p className="text-[13px] text-[#9a9a9a] mt-0.5">
          Upload and validate your installer data
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
