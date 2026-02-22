import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Mark the job as cancelled
    const [job] = await db
      .update(chunkJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(chunkJobs.id, id))
      .returning();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Mark any pending/processing chunks as cancelled
    await db
      .update(chunks)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(chunks.chunkJobId, id),
          inArray(chunks.status, ["pending", "processing"])
        )
      );

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
