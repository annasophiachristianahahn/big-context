import { NextResponse } from "next/server";
import { fetchModels } from "@/lib/openrouter";

export async function GET() {
  try {
    const models = await fetchModels();
    return NextResponse.json(models);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
