import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { chats, messages, apiCalls } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { chatCompletionStream, parseSSEStream, fetchModels, getModelById } from "@/lib/openrouter";
import { buildMessageContext } from "@/lib/context-manager";

export async function POST(request: NextRequest) {
  try {
    const { chatId, message } = await request.json();

    if (!chatId || !message) {
      return new Response(
        JSON.stringify({ error: "chatId and message required" }),
        { status: 400 }
      );
    }

    const chatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    const chat = chatResults[0];

    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
      });
    }

    // Save user message
    await db.insert(messages).values({
      chatId,
      role: "user",
      content: message,
    });

    // Update chat timestamp
    await db
      .update(chats)
      .set({ updatedAt: new Date() })
      .where(eq(chats.id, chatId));

    // Build context with history
    const dbMessages = await db
      .select({
        role: messages.role,
        content: messages.content,
        summary: messages.summary,
      })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));

    // Get model info for context window
    const modelList = await fetchModels();
    const modelInfo = getModelById(modelList, chat.model);
    const contextLength = modelInfo?.contextLength ?? 128000;

    const contextMessages = buildMessageContext(
      dbMessages,
      chat.systemPrompt,
      contextLength
    );

    // Stream response
    const openRouterResponse = await chatCompletionStream(
      chat.model,
      contextMessages
    );

    let fullContent = "";
    let usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost: 0,
      cost_details: null as Record<string, number> | null,
    };

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of parseSSEStream(openRouterResponse)) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullContent += content;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ content })}\n\n`
                )
              );
            }
            if (chunk.usage) {
              usage = {
                prompt_tokens: chunk.usage.prompt_tokens ?? 0,
                completion_tokens: chunk.usage.completion_tokens ?? 0,
                total_tokens: chunk.usage.total_tokens ?? 0,
                cost: chunk.usage.cost ?? 0,
                cost_details: (chunk.usage.cost_details as Record<string, number>) ?? null,
              };
            }
          }

          // Save assistant message
          const [assistantMessage] = await db
            .insert(messages)
            .values({
              chatId,
              role: "assistant",
              content: fullContent,
            })
            .returning();

          // Save API call
          await db.insert(apiCalls).values({
            chatId,
            messageId: assistantMessage.id,
            model: chat.model,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            cost: usage.cost,
            costBreakdown: usage.cost_details,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, usage })}\n\n`
            )
          );
          controller.close();
        } catch (error) {
          // Save partial content if we have any
          if (fullContent) {
            await db.insert(messages).values({
              chatId,
              role: "assistant",
              content: fullContent + "\n\n[Response interrupted]",
            });
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: (error as Error).message })}\n\n`
            )
          );
          controller.close();
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
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 }
    );
  }
}
