import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installers, activities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PIPELINE_STAGES } from "@/lib/constants";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const { stage } = await request.json();

  const validStage = PIPELINE_STAGES.find((s) => s.key === stage);
  if (!validStage) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  // Get current stage
  const [installer] = await db
    .select({ pipelineStage: installers.pipelineStage })
    .from(installers)
    .where(eq(installers.id, installerId))
    .limit(1);

  if (!installer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const oldStage = installer.pipelineStage || "uncontacted";
  const oldLabel =
    PIPELINE_STAGES.find((s) => s.key === oldStage)?.label || oldStage;
  const newLabel = validStage.label;

  // Update installer stage
  await db
    .update(installers)
    .set({
      pipelineStage: stage,
      pipelineStageUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(installers.id, installerId));

  // Log the stage change as an activity
  await db.insert(activities).values({
    installerId,
    type: "stage_change",
    content: `${oldLabel} → ${newLabel}`,
  });

  return NextResponse.json({ stage });
}
