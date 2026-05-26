import { NextRequest, NextResponse } from "next/server";
import { getInstallers } from "@/lib/queries/installers";
import { db } from "@/lib/db";
import { installers } from "@/lib/db/schema";

function boolParam(val: string | null): boolean | undefined {
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

function arrayParam(val: string | null): string[] | undefined {
  if (!val) return undefined;
  const arr = val.split(",").filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const filters = {
    search: searchParams.get("search") || undefined,
    zones: arrayParam(searchParams.get("zones")),
    counties: arrayParam(searchParams.get("counties")),
    technology: searchParams.get("technology") || undefined,
    region: searchParams.get("region") || undefined,
    tier: searchParams.get("tier") || undefined,
    pipelineStage: searchParams.get("stage") || undefined,
    boilerUpgradeScheme: searchParams.get("bus") || undefined,
    hasWebsite: boolParam(searchParams.get("hasWebsite")),
    hasEmail: boolParam(searchParams.get("hasEmail")),
    hasGoogleReviews: boolParam(searchParams.get("hasGoogleReviews")),
    hasTrustpilot: boolParam(searchParams.get("hasTrustpilot")),
    googleRatingMin: searchParams.get("googleRatingMin") ? Number(searchParams.get("googleRatingMin")) : undefined,
    trustpilotRatingMin: searchParams.get("trustpilotRatingMin") ? Number(searchParams.get("trustpilotRatingMin")) : undefined,
    reviewCountMin: searchParams.get("reviewCountMin") ? Number(searchParams.get("reviewCountMin")) : undefined,
    inMcs: boolParam(searchParams.get("inMcs")),
    inNova: boolParam(searchParams.get("inNova")),
    inTrustMark: boolParam(searchParams.get("inTrustMark")),
    scoreMin: searchParams.get("scoreMin") ? Number(searchParams.get("scoreMin")) : undefined,
    scoreMax: searchParams.get("scoreMax") ? Number(searchParams.get("scoreMax")) : undefined,
    isShortlisted: boolParam(searchParams.get("isShortlisted")),
    hasCrmTool: boolParam(searchParams.get("hasCrmTool")),
    crmToolName: searchParams.get("crmToolName") || undefined,
    formType: searchParams.get("formType") || undefined,
    originLat: searchParams.get("originLat") ? Number(searchParams.get("originLat")) : undefined,
    originLng: searchParams.get("originLng") ? Number(searchParams.get("originLng")) : undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    pageSize: searchParams.get("pageSize")
      ? Number(searchParams.get("pageSize"))
      : 100,
    sortBy: searchParams.get("sortBy") || "companyName",
    sortOrder: (searchParams.get("sortOrder") || "asc") as "asc" | "desc",
  };

  try {
    const t0 = performance.now();
    const result = await getInstallers(filters);
    const queryMs = (performance.now() - t0).toFixed(0);
    const payloadKb = (JSON.stringify(result).length / 1024).toFixed(1);
    console.log(`[installers API] query=${queryMs}ms rows=${result.data.length} total=${result.total} payload=${payloadKb}KB`);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Installers API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error", data: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.companyName?.trim()) {
    return NextResponse.json(
      { error: "Company name is required" },
      { status: 400 }
    );
  }

  const [installer] = await db
    .insert(installers)
    .values({
      companyName: body.companyName.trim(),
      email: body.email?.trim() || null,
      telephone: body.telephone?.trim() || null,
      website: body.website?.trim() || null,
      address: body.address?.trim() || null,
      county: body.county?.trim() || null,
      postcode: body.postcode?.trim() || null,
      pipelineStage: "target",
    })
    .returning();

  return NextResponse.json(installer);
}
