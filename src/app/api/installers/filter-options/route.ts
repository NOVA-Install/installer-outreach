import { NextResponse } from "next/server";
import { getDistinctCounties, getDistinctCrmTools } from "@/lib/queries/installers";

export async function GET() {
  const [counties, crmTools] = await Promise.all([
    getDistinctCounties(),
    getDistinctCrmTools(),
  ]);

  return NextResponse.json({ counties, crmTools }, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}
