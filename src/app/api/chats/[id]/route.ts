import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const chatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.id, id))
      .limit(1);

    const chat = chatResults[0];
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const chatMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({ ...chat, messages: chatMessages });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.systemPrompt !== undefined)
      updateData.systemPrompt = body.systemPrompt;

    const [chat] = await db
      .update(chats)
      .set(updateData)
      .where(eq(chats.id, id))
      .returning();

    return NextResponse.json(chat);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(chats).where(eq(chats.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
