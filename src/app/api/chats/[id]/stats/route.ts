import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiCalls } from "@/lib/db/schema";
import { eq, sum, count } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [stats] = await db
      .select({
        totalApiCalls: count(apiCalls.id),
        totalPromptTokens: sum(apiCalls.promptTokens),
        totalCompletionTokens: sum(apiCalls.completionTokens),
        totalTokens: sum(apiCalls.totalTokens),
        totalCost: sum(apiCalls.cost),
      })
      .from(apiCalls)
      .where(eq(apiCalls.chatId, id));

    // Calculate cache savings from costBreakdown JSON
    const allCalls = await db
      .select({ costBreakdown: apiCalls.costBreakdown })
      .from(apiCalls)
      .where(eq(apiCalls.chatId, id));

    let totalCacheSavings = 0;
    for (const call of allCalls) {
      const breakdown = call.costBreakdown as Record<string, number> | null;
      if (breakdown?.cache_read_input_cost) {
        totalCacheSavings += breakdown.cache_read_input_cost;
      }
    }

    return NextResponse.json({
      totalApiCalls: Number(stats.totalApiCalls) || 0,
      totalPromptTokens: Number(stats.totalPromptTokens) || 0,
      totalCompletionTokens: Number(stats.totalCompletionTokens) || 0,
      totalTokens: Number(stats.totalTokens) || 0,
      totalCost: Number(stats.totalCost) || 0,
      totalCacheSavings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
