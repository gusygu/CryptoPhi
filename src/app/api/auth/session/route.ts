export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // NextAuth is not configured; return a stable JSON placeholder
  return Response.json({
    ok: false,
    user: null,
    message: "nextauth_not_configured",
  });
}
