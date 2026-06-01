import { CampaignDetail } from "@/components/mystery-shopping/campaign-detail";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-6 space-y-4">
      <CampaignDetail campaignId={Number(id)} />
    </div>
  );
}
