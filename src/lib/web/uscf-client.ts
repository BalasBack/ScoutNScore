import type { OpponentCandidate, UscfMember, UscfRating } from "../types";
import { fetchJsonCors } from "./cors-fetch";
import { normalizePersonQuery, sortByNameMatch } from "./name-match";

const BASE = "https://ratings-api.uschess.org/api/v1/members";

/** USCF API uses short codes; normalize to names the rest of the app expects. */
const SYSTEM_MAP: Record<string, string> = {
  R: "OverTheBoardRegular",
  Q: "OverTheBoardQuick",
  B: "OverTheBoardBlitz",
  OR: "OnlineRegular",
  OQ: "OnlineQuick",
  OB: "OnlineBlitz",
};

type ApiRating = {
  ratingSystem?: string;
  rating?: number;
  gamesPlayed?: number;
  isProvisional?: boolean;
};

type ApiMember = {
  id?: string | number;
  firstName?: string;
  lastName?: string;
  stateRep?: string;
  fideId?: string | number;
  status?: string;
  ratings?: ApiRating[];
};

type SearchResponse = {
  items?: ApiMember[];
};

function normalizeSystem(code: string): string {
  return SYSTEM_MAP[code] ?? code;
}

function mapMember(m: ApiMember): UscfMember {
  const id = String(m.id ?? "").trim();
  if (!id) throw new Error("Invalid USCF member response (missing id)");
  return {
    id,
    first_name: m.firstName ?? "",
    last_name: m.lastName ?? "",
    state: m.stateRep ?? null,
    fide_id: m.fideId != null ? String(m.fideId) : null,
    status: m.status ?? null,
    ratings: (m.ratings ?? []).map(
      (r): UscfRating => ({
        rating_system: normalizeSystem(r.ratingSystem ?? ""),
        rating: r.rating ?? null,
        games_played: r.gamesPlayed ?? null,
        is_provisional: !!r.isProvisional,
      }),
    ),
  };
}

async function fetchUscfJson(url: string): Promise<unknown> {
  try {
    return await fetchJsonCors(url);
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? e.message
        : "USCF lookup failed (network/CORS). Try again shortly.",
    );
  }
}

export async function lookupUscfMember(uscfId: string): Promise<UscfMember> {
  const id = uscfId.trim();
  if (!id) throw new Error("Enter a USCF member ID");
  const data = (await fetchUscfJson(
    `${BASE}/${encodeURIComponent(id)}`,
  )) as ApiMember;
  return mapMember(data);
}

/**
 * USCF name search uses the `Fuzzy` query param (not lastName/firstName —
 * those are ignored by the API and return top GMs).
 */
export async function searchUscfMembers(
  query: string,
  limit = 12,
): Promise<UscfMember[]> {
  const raw = query.trim();
  if (!raw) return [];

  if (/^\d+$/.test(raw)) {
    try {
      return [await lookupUscfMember(raw)];
    } catch {
      return [];
    }
  }

  const fuzzy = normalizePersonQuery(raw);
  if (!fuzzy) return [];

  // Fetch a wider page then rank locally so best matches surface first
  const params = new URLSearchParams({
    Fuzzy: fuzzy,
    Size: String(Math.max(limit * 3, 24)),
  });
  const data = (await fetchUscfJson(
    `${BASE}?${params.toString()}`,
  )) as SearchResponse;

  const members = (data.items ?? []).map(mapMember);
  return sortByNameMatch(
    fuzzy,
    members,
    (m) => `${m.first_name} ${m.last_name}`,
    40,
  ).slice(0, limit);
}

export function memberToCandidate(member: UscfMember): OpponentCandidate {
  const primary =
    member.ratings.find(
      (r) => r.rating_system.includes("Regular") && r.rating != null,
    )?.rating ??
    member.ratings.find((r) => r.rating != null)?.rating ??
    null;
  return {
    id: `uscf_${member.id}`,
    name: `${member.first_name} ${member.last_name}`.trim(),
    source: "uscf",
    rating: primary,
    federation: member.state,
    fide_id: member.fide_id,
    uscf_id: member.id,
    chessgames_id: null,
    chesscom_username: null,
    lichess_username: null,
  };
}
