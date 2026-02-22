import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { eq, ilike, desc, and } from "drizzle-orm";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q");
    if (!query || query.trim().length === 0) {
      return NextResponse.json([]);
    }

    const searchPattern = `%${query}%`;

    // Search in message content
    const matchingMessages = await db
      .select({
        chatId: messages.chatId,
        chatTitle: chats.title,
        chatModel: chats.model,
        messageContent: messages.content,
        messageRole: messages.role,
        chatUpdatedAt: chats.updatedAt,
      })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(eq(chats.userId, DEFAULT_USER_ID), ilike(messages.content, searchPattern)))
      .orderBy(desc(chats.updatedAt))
      .limit(20);

    // Deduplicate by chat
    const chatMap = new Map<
      string,
      {
        chatId: string;
        title: string;
        model: string;
        matchCount: number;
        preview: string;
      }
    >();

    for (const m of matchingMessages) {
      const existing = chatMap.get(m.chatId);
      if (existing) {
        existing.matchCount++;
      } else {
        chatMap.set(m.chatId, {
          chatId: m.chatId,
          title: m.chatTitle,
          model: m.chatModel,
          matchCount: 1,
          preview: m.messageContent.slice(0, 200),
        });
      }
    }

    return NextResponse.json(Array.from(chatMap.values()));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
