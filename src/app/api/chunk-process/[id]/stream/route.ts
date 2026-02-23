import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

// A job is considered stale if its updatedAt hasn't changed in this many ms
// and it still has chunks in "processing" or "pending" state.
const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const encoder = new TextEncoder();
  console.log(`[BigContext:SSE] Stream opened for job ${id}`);
  let pollCount = 0;
  let lastSeenCompleted = -1;
  let lastProgressTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller may be closed if client disconnected
        }
      };

      let isComplete = false;

      while (!isComplete) {
        try {
          const jobResults = await db
            .select()
            .from(chunkJobs)
            .where(eq(chunkJobs.id, id))
            .limit(1);

          const job = jobResults[0];
          if (!job) {
            sendEvent({ error: "Job not found" });
            controller.close();
            return;
          }

          // Single query for chunk list with aggregates computed in JS
          const chunkList = await db
            .select({
              index: chunks.index,
              status: chunks.status,
              error: chunks.error,
              tokens: chunks.tokens,
              cost: chunks.cost,
            })
            .from(chunks)
            .where(eq(chunks.chunkJobId, id))
            .orderBy(asc(chunks.index));

          // Compute aggregates from the chunk list
          let totalTokens = 0;
          let totalCost = 0;
          let failedCount = 0;
          for (const c of chunkList) {
            totalTokens += c.tokens ?? 0;
            totalCost += c.cost ?? 0;
            if (c.status === "failed") failedCount++;
          }

          pollCount++;
          const chunkStatuses = chunkList.map(c => c.status).reduce((acc, s) => {
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          // Log every 5th poll to avoid excessive logging
          if (pollCount % 5 === 1 || job.status !== "processing") {
            console.log(`[BigContext:SSE] Poll #${pollCount} job=${id}: status=${job.status}, completed=${job.completedChunks}/${job.totalChunks}, chunks=${JSON.stringify(chunkStatuses)}, tokens=${totalTokens}`);
          }

          // --- Staleness detection ---
          // Track whether progress is being made. If completedChunks hasn't
          // changed for STALE_THRESHOLD_MS, the job is likely orphaned from
          // a server restart / redeploy.
          if (job.completedChunks !== lastSeenCompleted) {
            lastSeenCompleted = job.completedChunks;
            lastProgressTime = Date.now();
          }

          const timeSinceProgress = Date.now() - lastProgressTime;
          const isStale =
            job.status === "processing" &&
            timeSinceProgress > STALE_THRESHOLD_MS &&
            job.completedChunks < job.totalChunks;

          sendEvent({
            id: job.id,
            status: job.status,
            totalChunks: job.totalChunks,
            completedChunks: job.completedChunks,
            chunks: chunkList.map((c) => ({
              index: c.index,
              status: c.status,
              error: c.error,
            })),
            totalTokens,
            totalCost,
            failedChunks: failedCount,
            startedAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
            model: job.model,
            // Staleness indicator for the frontend
            isStale,
            staleDurationMs: isStale ? timeSinceProgress : 0,
            // Send stitchedOutput when terminal state is reached
            stitchedOutput:
              (job.status === "completed" || job.status === "cancelled")
                ? job.stitchedOutput
                : undefined,
          });

          // Terminal states: close the stream
          if (
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled"
          ) {
            console.log(`[BigContext:SSE] Job ${id} terminal: status=${job.status}, hasOutput=${!!job.stitchedOutput}, outputLen=${job.stitchedOutput?.length ?? 0}`);
            isComplete = true;
            sendEvent({ done: true });
            controller.close();
            return;
          }

          // Wait before next poll
          await new Promise((r) => setTimeout(r, 1500));
        } catch {
          controller.close();
          return;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
