import { InstallerTable } from "@/components/installers/installer-table";
import { AddInstallerDialog } from "@/components/installers/add-installer-dialog";
import { getDistinctCounties, getDistinctCrmTools } from "@/lib/queries/installers";

export const dynamic = "force-dynamic";

export default async function InstallersPage() {
  let counties: string[] = [];
  let crmTools: string[] = [];
  try {
    [counties, crmTools] = await Promise.all([
      getDistinctCounties(),
      getDistinctCrmTools(),
    ]);
  } catch (err) {
    console.error("Installers page query error:", err);
  }

  return (
    <div className="flex h-full flex-col">
      <InstallerTable counties={counties} crmTools={crmTools} />
    </div>
  );
}
