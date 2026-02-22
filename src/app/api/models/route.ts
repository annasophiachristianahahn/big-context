import { NextResponse } from "next/server";
import { fetchModels } from "@/lib/openrouter";

export async function GET() {
  try {
    const models = await fetchModels();
    return NextResponse.json(models, {
      headers: {
        // Browser caches for 1 hour, serves stale for 24h while revalidating
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
