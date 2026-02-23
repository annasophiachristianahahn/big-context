import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chunkJobs, chunks } from "@/lib/db/schema";
import { eq, desc, asc } from "drizzle-orm";

/**
 * GET /api/chats/[id]/document
 *
 * Reconstructs the original document text from chunk records
 * for the most recent chunk job in this chat.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await params;

  // Find the most recent chunk job for this chat
  const jobs = await db
    .select({ id: chunkJobs.id, instruction: chunkJobs.instruction })
    .from(chunkJobs)
    .where(eq(chunkJobs.chatId, chatId))
    .orderBy(desc(chunkJobs.createdAt))
    .limit(1);

  if (jobs.length === 0) {
    return NextResponse.json({ error: "No chunk job found" }, { status: 404 });
  }

  // Get all chunk input texts in order
  const chunkList = await db
    .select({ index: chunks.index, inputText: chunks.inputText })
    .from(chunks)
    .where(eq(chunks.chunkJobId, jobs[0].id))
    .orderBy(asc(chunks.index));

  const documentText = chunkList.map((c) => c.inputText).join("");

  return NextResponse.json({
    text: documentText,
    instruction: jobs[0].instruction,
    chunkCount: chunkList.length,
    charCount: documentText.length,
  });
}
