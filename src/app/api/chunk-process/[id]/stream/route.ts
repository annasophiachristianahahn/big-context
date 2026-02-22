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
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
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

          const chunkList = await db
            .select({
              index: chunks.index,
              status: chunks.status,
              error: chunks.error,
            })
            .from(chunks)
            .where(eq(chunks.chunkJobId, id))
            .orderBy(asc(chunks.index));

          // Aggregate token/cost data from completed chunks
          const [aggregates] = await db
            .select({
              totalTokens: sql<number>`COALESCE(SUM(${chunks.tokens}), 0)`,
              totalCost: sql<number>`COALESCE(SUM(${chunks.cost}), 0)`,
              failedCount: sql<number>`COUNT(CASE WHEN ${chunks.status} = 'failed' THEN 1 END)`,
            })
            .from(chunks)
            .where(eq(chunks.chunkJobId, id));

          sendEvent({
            id: job.id,
            status: job.status,
            totalChunks: job.totalChunks,
            completedChunks: job.completedChunks,
            chunks: chunkList,
            totalTokens: Number(aggregates?.totalTokens ?? 0),
            totalCost: Number(aggregates?.totalCost ?? 0),
            failedChunks: Number(aggregates?.failedCount ?? 0),
            startedAt: job.createdAt.toISOString(),
            model: job.model,
            stitchedOutput:
              (job.status === "completed" || job.status === "cancelled") ? job.stitchedOutput : undefined,
          });

          if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
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
