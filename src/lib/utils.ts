// src/lib/utils.ts
// Minimal class name merger used by UI components (shadcn replacement).

type ClassDictionary = Record<string, boolean | string | number | null | undefined>;
type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassDictionary
  | ClassValue[];

function toArray(value: ClassValue): Array<string | ClassDictionary> {
  if (Array.isArray(value)) return value.flatMap(toArray);
  if (value && typeof value === "object" && !("toString" in value)) {
    return [value as ClassDictionary];
  }
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  return [];
}

export function cn(...inputs: ClassValue[]): string {
  const tokens: string[] = [];

  for (const input of inputs.flatMap(toArray)) {
    if (typeof input === "string") {
      if (input.trim()) tokens.push(input.trim());
      continue;
    }

    for (const [key, active] of Object.entries(input)) {
      if (!key) continue;
      if (typeof active === "boolean") {
        if (active) tokens.push(key);
      } else if (active != null && Boolean(active)) {
        tokens.push(key);
      }
    }
  }

  return tokens.join(" ");
}
