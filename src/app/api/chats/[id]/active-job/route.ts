import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs } from "@/lib/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

/**
 * GET /api/chats/[id]/active-job
 *
 * Returns the most recent non-terminal chunk job for this chat.
 * Used by the frontend to restore ChunkProgress UI after page reload.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await params;

  const activeJobs = await db
    .select({ id: chunkJobs.id, status: chunkJobs.status, updatedAt: chunkJobs.updatedAt })
    .from(chunkJobs)
    .where(
      and(
        eq(chunkJobs.chatId, chatId),
        inArray(chunkJobs.status, ["processing", "stitching", "pending"])
      )
    )
    .orderBy(desc(chunkJobs.createdAt))
    .limit(1);

  if (activeJobs.length === 0) {
    return NextResponse.json({ activeJobId: null });
  }

  return NextResponse.json({
    activeJobId: activeJobs[0].id,
    status: activeJobs[0].status,
    updatedAt: activeJobs[0].updatedAt.toISOString(),
  });
}
