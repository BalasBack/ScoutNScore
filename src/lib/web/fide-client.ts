import type { OpponentCandidate } from "../types";
import { fetchTextCors } from "./cors-fetch";
import { normalizePersonQuery, sortByNameMatch } from "./name-match";

/**
 * FIDE ratings search via ratings.fide.com HTML (same endpoint as desktop).
 */
export async function searchFidePlayers(
  query: string,
  limit = 12,
): Promise<OpponentCandidate[]> {
  const q = normalizePersonQuery(query);
  if (!q) return [];

  const url =
    `https://ratings.fide.com/incl_search_l.php?search=${encodeURIComponent(q)}` +
    `&searchoption=name`;

  const html = await fetchTextCors(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://ratings.fide.com/",
    },
  });

  if (/No results found/i.test(html)) return [];

  const results: OpponentCandidate[] = [];
  const rowRe =
    /<td[^>]*data-label="FIDEID"[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*data-label="Name"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/gis;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const fideId = match[1];
    const name = match[2].trim();
    if (!name) continue;

    const afterId = html.slice(match.index, match.index + 900);
    const stdRating = afterId.match(/data-label="Rtg"[^>]*>\s*(\d+)\s*</i)?.[1];
    const fedMatch = afterId.match(/alt="([A-Z]{3})">\s*([A-Z]{3})/);

    results.push({
      id: `fide_${fideId}`,
      name,
      source: "fide",
      rating: stdRating ? Number(stdRating) : null,
      federation: fedMatch?.[2] ?? null,
      fide_id: fideId,
      uscf_id: null,
      chessgames_id: null,
      chesscom_username: null,
      lichess_username: null,
    });
  }

  return sortByNameMatch(q, results, (c) => c.name, 20).slice(0, limit);
}
