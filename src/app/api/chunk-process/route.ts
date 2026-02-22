import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chats, messages, chunkJobs, chunks, apiCalls } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  splitTextIntoChunks,
  calculateMaxChunkTokens,
} from "@/lib/chunker";
import { estimateTokens, estimateCost } from "@/lib/token-estimator";
import { fetchModels, getModelById, generateChatTitle } from "@/lib/openrouter";
import { processChunksInParallel, stitchResults } from "@/lib/parallel-processor";

export async function POST(request: NextRequest) {
  try {
    const {
      chatId,
      text,
      instruction,
      model: modelOverride,
      enableStitchPass,
    } = await request.json();

    if (!chatId || !text || !instruction) {
      return NextResponse.json(
        { error: "chatId, text, and instruction are required" },
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
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const modelId = modelOverride ?? chat.model;
    const modelList = await fetchModels();
    const model = getModelById(modelList, modelId);

    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 400 });
    }

    // Cost estimate mode
    const url = new URL(request.url);
    if (url.searchParams.get("estimate") === "true") {
      const estimate = estimateCost(
        text,
        instruction,
        model,
        enableStitchPass ?? false
      );
      return NextResponse.json(estimate);
    }

    // Split text into chunks (respects both context window and max output limits)
    const instructionTokens = estimateTokens(instruction);
    const maxChunkTokens = calculateMaxChunkTokens(
      model.contextLength,
      instructionTokens,
      model.maxOutput
    );
    const chunkInputs = splitTextIntoChunks(text, maxChunkTokens);
    // Create ChunkJob and Chunk records
    const [chunkJob] = await db
      .insert(chunkJobs)
      .values({
        chatId,
        status: "processing",
        totalChunks: chunkInputs.length,
        completedChunks: 0,
        instruction,
        model: modelId,
        enableStitchPass: enableStitchPass ? 1 : 0,
      })
      .returning();

    // Create chunk records
    await db.insert(chunks).values(
      chunkInputs.map((c) => ({
        chunkJobId: chunkJob.id,
        index: c.index,
        inputText: c.text,
        status: "pending",
      }))
    );

    // Save user message describing the job
    await db.insert(messages).values({
      chatId,
      role: "user",
      content: `[Big Context Processing]\nInstruction: ${instruction}\nText length: ${text.length.toLocaleString()} characters (~${estimateTokens(text).toLocaleString()} tokens)\nChunks: ${chunkInputs.length} (${maxChunkTokens.toLocaleString()} tokens/chunk)\nModel: ${model.name} (context: ${model.contextLength.toLocaleString()}, max output: ${model.maxOutput.toLocaleString()})`,
    });

    // Process asynchronously (don't await)
    processChunksInParallel(
      chunkJob.id,
      chunkInputs,
      instruction,
      modelId,
      chunkInputs.length,
      model.maxOutput
    )
      .then(async (results) => {
        const orderedOutputs = results
          .filter((r) => r.status === "completed")
          .sort((a, b) => a.index - b.index)
          .map((r) => r.output);

        let finalOutput = orderedOutputs.join("\n\n");
        let stitchTokens = 0;
        let stitchCost = 0;

        if (enableStitchPass && orderedOutputs.length > 1) {
          // Set "stitching" status so UI can show what's happening
          await db
            .update(chunkJobs)
            .set({ status: "stitching", updatedAt: new Date() })
            .where(eq(chunkJobs.id, chunkJob.id));

          const stitchResult = await stitchResults(
            orderedOutputs,
            instruction,
            modelId,
            model.contextLength,
            model.maxOutput
          );
          finalOutput = stitchResult.output;
          stitchTokens = stitchResult.tokens;
          stitchCost = stitchResult.cost;
        }

        const totalTokens =
          results.reduce((sum, r) => sum + r.tokens, 0) + stitchTokens;
        const totalCost =
          results.reduce((sum, r) => sum + r.cost, 0) + stitchCost;
        const failedCount = results.filter(
          (r) => r.status === "failed"
        ).length;

        // IMPORTANT: Write stitchedOutput and status atomically in one update
        // to prevent race condition where status is "completed" but output is null
        await db
          .update(chunkJobs)
          .set({
            status: failedCount === results.length ? "failed" : "completed",
            stitchedOutput: finalOutput,
            updatedAt: new Date(),
          })
          .where(eq(chunkJobs.id, chunkJob.id));

        // Save assistant message with summary for context management
        const summary =
          finalOutput.length > 2000
            ? finalOutput.slice(0, 2000) + "... [truncated for context]"
            : null;

        const [assistantMessage] = await db
          .insert(messages)
          .values({
            chatId,
            role: "assistant",
            content: finalOutput || "[No output produced — all chunks may have failed]",
            summary,
          })
          .returning();

        // Save aggregated API call with actual breakdown
        const chunkInputTokens = results.reduce((sum, r) => sum + Math.round(r.tokens * 0.7), 0);
        const chunkOutputTokens = results.reduce((sum, r) => sum + Math.round(r.tokens * 0.3), 0);
        await db.insert(apiCalls).values({
          chatId,
          messageId: assistantMessage.id,
          model: modelId,
          promptTokens: chunkInputTokens + (stitchTokens > 0 ? Math.round(stitchTokens * 0.7) : 0),
          completionTokens: chunkOutputTokens + (stitchTokens > 0 ? Math.round(stitchTokens * 0.3) : 0),
          totalTokens,
          cost: totalCost,
        });

        // Auto-title chat if still "New Chat"
        if (chat.title === "New Chat") {
          const titleContent = `[${instruction}]\n\n${text.slice(0, 1000)}`;
          generateChatTitle(modelId, titleContent)
            .then(async (title) => {
              await db
                .update(chats)
                .set({ title })
                .where(eq(chats.id, chatId));
            })
            .catch((err) => console.error("Auto-title failed:", err));
        }
      })
      .catch(async (error) => {
        await db
          .update(chunkJobs)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(chunkJobs.id, chunkJob.id));

        await db.insert(messages).values({
          chatId,
          role: "assistant",
          content: `[Big Context Processing Failed]\nError: ${(error as Error).message}`,
        });
      });

    return NextResponse.json(
      {
        jobId: chunkJob.id,
        totalChunks: chunkInputs.length,
        status: "processing",
        debug: {
          modelId,
          modelName: model.name,
          contextLength: model.contextLength,
          maxOutput: model.maxOutput,
          instructionTokens,
          maxChunkTokens,
          textLength: text.length,
          estimatedTextTokens: estimateTokens(text),
        },
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
