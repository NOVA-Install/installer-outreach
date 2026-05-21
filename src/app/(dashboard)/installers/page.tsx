import { InstallerTable } from "@/components/installers/installer-table";
import { AddInstallerDialog } from "@/components/installers/add-installer-dialog";
import { getDistinctCounties } from "@/lib/queries/installers";

export const dynamic = "force-dynamic";

export default async function InstallersPage() {
  const counties = await getDistinctCounties();

  return (
    <div className="flex h-full flex-col">
      <InstallerTable counties={counties} />
    </div>
  );
}
