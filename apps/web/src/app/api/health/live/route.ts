import { NextResponse } from "next/server";
export const GET = () =>
  NextResponse.json({ data: { status: "ok" }, requestId: crypto.randomUUID() });
