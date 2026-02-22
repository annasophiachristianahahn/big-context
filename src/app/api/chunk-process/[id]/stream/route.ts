import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

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

          sendEvent({
            id: job.id,
            status: job.status,
            totalChunks: job.totalChunks,
            completedChunks: job.completedChunks,
            chunks: chunkList,
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
          await new Promise((r) => setTimeout(r, 1000));
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
