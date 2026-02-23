import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks, messages, chats, apiCalls } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { processChunksInParallel, stitchResults } from "@/lib/parallel-processor";
import { fetchModels, getModelById, generateChatTitle } from "@/lib/openrouter";
import type { ChunkInput } from "@/types";

/**
 * POST /api/chunk-process/[id]/resume
 *
 * Resumes an orphaned/stuck chunk job. This handles the case where:
 * 1. Server redeployed mid-processing (Railway redeploy)
 * 2. Chunks got stuck in "processing" state with no worker
 *
 * Resets stuck chunks to "pending" and restarts parallel processing.
 */
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

    // Only resume jobs that are stuck in processing/stitching
    if (!["processing", "stitching", "pending"].includes(job.status)) {
      return NextResponse.json({
        message: `Job is already ${job.status}, no resume needed`,
        status: job.status,
      });
    }

    // Get model info
    const modelList = await fetchModels();
    const model = getModelById(modelList, job.model);

    // Find chunks that need processing (stuck in "processing" or still "pending")
    const stuckChunks = await db
      .select()
      .from(chunks)
      .where(
        and(
          eq(chunks.chunkJobId, id),
          inArray(chunks.status, ["processing", "pending"])
        )
      );

    if (stuckChunks.length === 0) {
      // All chunks are done (completed or failed) — job just needs finalization
      // This can happen if server crashed after chunks completed but before
      // the .then() handler saved the assistant message
      const allChunks = await db
        .select()
        .from(chunks)
        .where(eq(chunks.chunkJobId, id));

      const successfulOutputs = allChunks
        .filter((c) => c.status === "completed" && c.outputText)
        .sort((a, b) => a.index - b.index)
        .map((c) => c.outputText!);

      const failedCount = allChunks.filter((c) => c.status === "failed").length;
      const finalOutput = successfulOutputs.join("\n\n");
      const finalStatus = failedCount === allChunks.length ? "failed" : "completed";

      await db
        .update(chunkJobs)
        .set({
          status: finalStatus,
          stitchedOutput: finalOutput,
          updatedAt: new Date(),
        })
        .where(eq(chunkJobs.id, id));

      // Check if assistant message already exists — avoid duplicates
      const existingMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, job.chatId));
      const hasAssistantResponse = existingMessages.some(
        (m) => m.role === "assistant" && !m.content.startsWith("[Big Context Processing")
      );

      if (!hasAssistantResponse) {
        await db.insert(messages).values({
          chatId: job.chatId,
          role: "assistant",
          content: finalOutput || "[No output — all chunks failed]",
          summary: finalOutput.length > 2000
            ? finalOutput.slice(0, 2000) + "... [truncated for context]"
            : null,
        });
      }

      return NextResponse.json({
        message: "Job finalized — all chunks were already done",
        status: finalStatus,
        resumedChunks: 0,
      });
    }

    // Reset stuck "processing" chunks back to "pending"
    const processingChunks = stuckChunks.filter((c) => c.status === "processing");
    for (const chunk of processingChunks) {
      await db
        .update(chunks)
        .set({ status: "pending", error: null })
        .where(eq(chunks.id, chunk.id));
    }

    // Recalculate completedChunks from the DB
    const allChunks = await db
      .select()
      .from(chunks)
      .where(eq(chunks.chunkJobId, id));
    const actuallyCompleted = allChunks.filter(
      (c) => c.status === "completed" || c.status === "failed"
    ).length;

    // Update job status
    await db
      .update(chunkJobs)
      .set({
        status: "processing",
        completedChunks: actuallyCompleted,
        updatedAt: new Date(),
      })
      .where(eq(chunkJobs.id, id));

    // Rebuild chunk inputs for the ones that need processing
    const chunksToProcess = stuckChunks.map((c) => ({
      index: c.index,
      text: c.inputText,
    }));

    console.log(`[BigContext:Resume] Resuming job ${id}: ${chunksToProcess.length} chunks to reprocess (${processingChunks.length} were stuck in "processing")`);

    // Fire-and-forget processing — same pattern as the original route
    processChunksInParallel(
      id,
      chunksToProcess,
      job.instruction,
      job.model,
      job.totalChunks,
      model?.maxOutput
    )
      .then(async () => {
        console.log(`[BigContext:Resume] Job ${id} chunks complete, finalizing...`);

        const finalChunks = await db
          .select()
          .from(chunks)
          .where(eq(chunks.chunkJobId, id));

        const successfulOutputs = finalChunks
          .filter((c) => c.status === "completed" && c.outputText)
          .sort((a, b) => a.index - b.index)
          .map((c) => c.outputText!);

        let finalOutput = successfulOutputs.join("\n\n");
        let stitchTokens = 0;
        let stitchCost = 0;

        if (job.enableStitchPass && successfulOutputs.length > 1) {
          await db
            .update(chunkJobs)
            .set({ status: "stitching", updatedAt: new Date() })
            .where(eq(chunkJobs.id, id));

          const stitchResult = await stitchResults(
            successfulOutputs,
            job.instruction,
            job.model,
            model?.contextLength ?? 128000,
            model?.maxOutput
          );
          finalOutput = stitchResult.output;
          stitchTokens = stitchResult.tokens;
          stitchCost = stitchResult.cost;
        }

        const failedCount = finalChunks.filter((c) => c.status === "failed").length;
        const finalStatus = failedCount === finalChunks.length ? "failed" : "completed";

        await db
          .update(chunkJobs)
          .set({
            status: finalStatus,
            stitchedOutput: finalOutput,
            updatedAt: new Date(),
          })
          .where(eq(chunkJobs.id, id));

        // Check if assistant message already exists
        const existingMsgs = await db
          .select()
          .from(messages)
          .where(eq(messages.chatId, job.chatId));
        const hasAssistant = existingMsgs.some(
          (m) => m.role === "assistant" && !m.content.startsWith("[Big Context Processing")
        );

        if (!hasAssistant) {
          const [assistantMessage] = await db
            .insert(messages)
            .values({
              chatId: job.chatId,
              role: "assistant",
              content: finalOutput || "[No output — all chunks failed]",
              summary: finalOutput.length > 2000
                ? finalOutput.slice(0, 2000) + "... [truncated for context]"
                : null,
            })
            .returning();

          // Save API call stats
          const totalTokens = finalChunks.reduce((sum, c) => sum + (c.tokens ?? 0), 0) + stitchTokens;
          const totalCost = finalChunks.reduce((sum, c) => sum + (c.cost ?? 0), 0) + stitchCost;
          await db.insert(apiCalls).values({
            chatId: job.chatId,
            messageId: assistantMessage.id,
            model: job.model,
            promptTokens: Math.round(totalTokens * 0.7),
            completionTokens: Math.round(totalTokens * 0.3),
            totalTokens,
            cost: totalCost,
          });

          // Auto-title
          const chatResults = await db.select().from(chats).where(eq(chats.id, job.chatId)).limit(1);
          if (chatResults[0]?.title === "New Chat") {
            generateChatTitle(job.model, `[${job.instruction}]`)
              .then(async (title) => {
                await db.update(chats).set({ title }).where(eq(chats.id, job.chatId));
              })
              .catch((err) => console.error("Auto-title failed:", err));
          }
        }
      })
      .catch(async (error) => {
        console.error(`[BigContext:Resume] Job ${id} CRASHED:`, (error as Error).message);
        await db
          .update(chunkJobs)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(chunkJobs.id, id));
      });

    return NextResponse.json({
      message: "Job resumed",
      resumedChunks: chunksToProcess.length,
      status: "processing",
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
