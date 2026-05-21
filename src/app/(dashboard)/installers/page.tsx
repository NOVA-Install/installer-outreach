import { InstallerTable } from "@/components/installers/installer-table";
import { AddInstallerDialog } from "@/components/installers/add-installer-dialog";
import { getDistinctCounties } from "@/lib/queries/installers";

export const dynamic = "force-dynamic";

export default async function InstallersPage() {
  let counties: string[] = [];
  try {
    counties = await getDistinctCounties();
  } catch (err) {
    console.error("Installers page query error:", err);
  }

  return (
    <div className="flex h-full flex-col">
      <InstallerTable counties={counties} />
    </div>
  );
}
