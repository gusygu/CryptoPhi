export function getBrowserBadge(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("sessionId="));
  const value = match ? decodeURIComponent(match.split("=", 2)[1] ?? "") : "";
  const cleaned = value.trim();
  if (!cleaned || cleaned.toLowerCase() === "api") return null;
  return cleaned;
}
