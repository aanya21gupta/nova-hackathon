import { NextResponse } from "next/server";
import { llmStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";

// Reports only whether a key exists, never the key itself.
export function GET() {
  return NextResponse.json(llmStatus());
}
