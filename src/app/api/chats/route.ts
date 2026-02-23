import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { eq, desc, count, inArray } from "drizzle-orm";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function GET() {
  try {
    const chatList = await db
      .select({
        id: chats.id,
        title: chats.title,
        model: chats.model,
        systemPrompt: chats.systemPrompt,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
        messageCount: count(messages.id),
      })
      .from(chats)
      .leftJoin(messages, eq(messages.chatId, chats.id))
      .where(eq(chats.userId, DEFAULT_USER_ID))
      .groupBy(chats.id)
      .orderBy(desc(chats.updatedAt));

    return NextResponse.json(chatList);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const [chat] = await db
      .insert(chats)
      .values({
        userId: DEFAULT_USER_ID,
        title: body.title ?? "New Chat",
        model: body.model ?? "google/gemini-2.5-flash",
        systemPrompt: body.systemPrompt ?? null,
      })
      .returning();

    return NextResponse.json(chat, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/** DELETE /api/chats — bulk delete multiple chats */
export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }
    await db.delete(chats).where(inArray(chats.id, ids));
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
