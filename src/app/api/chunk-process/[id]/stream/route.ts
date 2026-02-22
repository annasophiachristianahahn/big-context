import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const encoder = new TextEncoder();

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
          // (avoids 3 separate DB queries per poll)
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
            model: job.model,
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
