/** Score how well a candidate name matches the search query (higher = better). */
export function nameMatchScore(query: string, name: string): number {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;

  if (n === q) return 1000;

  const qTokens = tokens(q);
  const nTokens = tokens(n);
  if (!qTokens.length || !nTokens.length) return 0;

  // Exact token-set match (order-insensitive): "hikaru nakamura" vs "nakamura hikaru"
  if (
    qTokens.length === nTokens.length &&
    qTokens.every((t) => nTokens.includes(t))
  ) {
    return 900;
  }

  let score = 0;

  // All query tokens present in name
  const allPresent = qTokens.every((t) => nTokens.some((nt) => nt.includes(t) || t.includes(nt)));
  if (allPresent) score += 400;

  for (const qt of qTokens) {
    if (nTokens.includes(qt)) score += 120;
    else if (nTokens.some((nt) => nt.startsWith(qt))) score += 80;
    else if (nTokens.some((nt) => nt.includes(qt))) score += 40;
    else if (n.includes(qt)) score += 20;
  }

  // Prefer names that start with the query / first token
  if (n.startsWith(q)) score += 50;
  if (nTokens[0]?.startsWith(qTokens[0])) score += 30;

  // Prefer shorter names (less extra noise) when scores are close
  score -= Math.max(0, nTokens.length - qTokens.length) * 5;

  return score;
}

export function sortByNameMatch<T>(
  query: string,
  items: T[],
  getName: (item: T) => string,
  minScore = 1,
): T[] {
  return items
    .map((item) => ({ item, score: nameMatchScore(query, getName(item)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || getName(a.item).localeCompare(getName(b.item)))
    .map((x) => x.item);
}

/** "Nakamura, Hikaru" → "Hikaru Nakamura"; otherwise trim. */
export function normalizePersonQuery(query: string): string {
  const q = query.trim().replace(/^@/, "");
  if (!q) return "";
  if (q.includes(",")) {
    const [last, ...rest] = q.split(",").map((s) => s.trim());
    const first = rest.join(" ").trim();
    if (first && last) return `${first} ${last}`;
    return last || first;
  }
  return q;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return s.split(" ").filter(Boolean);
}
