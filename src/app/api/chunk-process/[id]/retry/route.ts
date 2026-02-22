import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { processChunksInParallel } from "@/lib/parallel-processor";
import { fetchModels, getModelById } from "@/lib/openrouter";
import type { ChunkInput } from "@/types";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const jobResults = await db
      .select()
      .from(chunkJobs)
      .where(eq(chunkJobs.id, id))
      .limit(1);

    const job = jobResults[0];
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get model info for maxOutputTokens
    const modelList = await fetchModels();
    const model = getModelById(modelList, job.model);

    // Get failed chunks
    const failedChunks = await db
      .select()
      .from(chunks)
      .where(and(eq(chunks.chunkJobId, id), eq(chunks.status, "failed")));

    if (failedChunks.length === 0) {
      return NextResponse.json({ message: "No failed chunks to retry" });
    }

    // Reset failed chunks to pending
    for (const chunk of failedChunks) {
      await db
        .update(chunks)
        .set({ status: "pending", error: null, outputText: null })
        .where(eq(chunks.id, chunk.id));
    }

    // Update job status
    await db
      .update(chunkJobs)
      .set({
        status: "processing",
        completedChunks: job.completedChunks - failedChunks.length,
        updatedAt: new Date(),
      })
      .where(eq(chunkJobs.id, id));

    // Rebuild chunk inputs from failed chunks
    const chunkInputs: ChunkInput[] = failedChunks.map((c) => ({
      index: c.index,
      text: c.inputText,
    }));

    // Reprocess asynchronously — pass maxOutputTokens so chunks aren't truncated
    processChunksInParallel(
      id,
      chunkInputs,
      job.instruction,
      job.model,
      job.totalChunks,
      model?.maxOutput
    ).then(async () => {
      // Check if all chunks are now done
      const allChunks = await db
        .select()
        .from(chunks)
        .where(eq(chunks.chunkJobId, id));

      const allCompleted = allChunks.every(
        (c) => c.status === "completed" || c.status === "failed"
      );

      if (allCompleted) {
        const successfulOutputs = allChunks
          .filter((c) => c.status === "completed" && c.outputText)
          .sort((a, b) => a.index - b.index)
          .map((c) => c.outputText!);

        const finalOutput = successfulOutputs.join("\n\n");
        const stillFailed = allChunks.filter(
          (c) => c.status === "failed"
        ).length;

        await db
          .update(chunkJobs)
          .set({
            status: stillFailed === allChunks.length ? "failed" : "completed",
            stitchedOutput: finalOutput,
            updatedAt: new Date(),
          })
          .where(eq(chunkJobs.id, id));
      }
    });

    return NextResponse.json({
      retriedChunks: failedChunks.length,
      status: "processing",
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
