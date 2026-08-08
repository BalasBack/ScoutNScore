import { useState } from "react";
import {
  Search,
  Shield,
  Loader2,
  BookOpen,
  Target,
  TrendingUp,
  Swords,
  Sparkles,
  Calendar,
} from "lucide-react";
import { api, OpponentCandidate, OpponentDossier, UscfMember } from "../lib/tauri";
import { Button, Card, Input, Label } from "../components/ui";
import { winRate } from "../lib/utils";

type SearchSource = "uscf" | "fide" | "online" | "chessgames";

const SEARCH_SOURCES: { id: SearchSource; label: string; hint: string }[] = [
  { id: "uscf", label: "USCF", hint: "US Chess Federation members" },
  { id: "fide", label: "FIDE", hint: "International rated players" },
  { id: "online", label: "Online Accounts", hint: "Lichess and Chess.com usernames" },
  { id: "chessgames", label: "Chessgames.com", hint: "ChessGames.com database" },
];

const SOURCE_IDS: Record<SearchSource, string[]> = {
  uscf: ["uscf"],
  fide: ["fide"],
  online: ["online"],
  chessgames: ["chessgames"],
};

function formatRatingSystem(system: string): string {
  return system
    .replace("OverTheBoard", "OTB ")
    .replace("Online", "Online ")
    .replace("Regular", "Regular")
    .replace("Quick", "Quick")
    .replace("Blitz", "Blitz");
}

function resultBadge(result: string): string {
  switch (result) {
    case "win":
      return "text-green-400";
    case "loss":
      return "text-red-400";
    default:
      return "text-[var(--color-muted)]";
  }
}

function resultLabel(result: string): string {
  switch (result) {
    case "win":
      return "W";
    case "loss":
      return "L";
    default:
      return "D";
  }
}

function OpeningTable({
  title,
  openings,
}: {
  title: string;
  openings: OpponentDossier["openings_as_white"];
}) {
  if (openings.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-surface-3)] text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Opening</th>
              <th className="px-2 py-2 text-right font-medium">G</th>
              <th className="px-2 py-2 text-right font-medium">W</th>
              <th className="px-2 py-2 text-right font-medium">D</th>
              <th className="px-2 py-2 text-right font-medium">L</th>
            </tr>
          </thead>
          <tbody>
            {openings.map((o) => (
              <tr
                key={`${o.color}-${o.name}`}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-3 py-2">
                  {o.eco && (
                    <span className="mr-1.5 font-mono text-[var(--color-accent)]">
                      {o.eco}
                    </span>
                  )}
                  {o.name}
                </td>
                <td className="px-2 py-2 text-right">{o.games}</td>
                <td className="px-2 py-2 text-right text-green-400">{o.wins}</td>
                <td className="px-2 py-2 text-right">{o.draws}</td>
                <td className="px-2 py-2 text-right text-red-400">{o.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DossierView({ dossier }: { dossier: OpponentDossier }) {
  const { candidate, record, ratings } = dossier;
  const totalGames = record.wins + record.draws + record.losses;

  const importParts = [
    dossier.games_imported_chesscom > 0 &&
      `${dossier.games_imported_chesscom} Chess.com`,
    dossier.games_imported_lichess > 0 &&
      `${dossier.games_imported_lichess} Lichess`,
    dossier.games_imported_chessgames > 0 &&
      `${dossier.games_imported_chessgames} ChessGames`,
  ].filter(Boolean);

  return (
    <div className="space-y-5 text-sm">
      {/* Profile header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[var(--color-accent)]/20 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
              {sourceBadge(candidate.source)}
            </span>
            {candidate.federation && (
              <span className="text-xs text-[var(--color-muted)]">
                {candidate.federation}
              </span>
            )}
            {candidate.uscf_id && (
              <span className="text-xs text-[var(--color-muted)]">
                USCF #{candidate.uscf_id}
              </span>
            )}
            {candidate.fide_id && (
              <span className="text-xs text-[var(--color-muted)]">
                FIDE {candidate.fide_id}
              </span>
            )}
          </div>
          <p className="mt-2 text-[var(--color-muted)]">{dossier.style_summary}</p>
        </div>
      </div>

      {/* Ratings */}
      {ratings.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <TrendingUp className="h-4 w-4 text-[var(--color-accent)]" />
            Ratings
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {ratings.map((r) => (
              <div
                key={`${r.source}-${r.label}`}
                className="rounded-lg bg-[var(--color-surface-3)] px-3 py-2"
              >
                <div className="text-xs text-[var(--color-muted)]">
                  {r.source} · {r.label}
                </div>
                <div className="text-lg font-bold">{r.rating}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record */}
      {totalGames > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Target className="h-4 w-4 text-[var(--color-accent)]" />
            Recent sample ({totalGames} games)
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[var(--color-surface-3)] p-3 text-center">
              <div className="text-xl font-bold text-green-400">{record.wins}</div>
              <div className="text-xs text-[var(--color-muted)]">Wins</div>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-3)] p-3 text-center">
              <div className="text-xl font-bold">{record.draws}</div>
              <div className="text-xs text-[var(--color-muted)]">Draws</div>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-3)] p-3 text-center">
              <div className="text-xl font-bold text-red-400">{record.losses}</div>
              <div className="text-xs text-[var(--color-muted)]">Losses</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
            <div className="rounded bg-[var(--color-surface-3)] px-3 py-2">
              As White: {record.as_white.wins}W-{record.as_white.draws}D-
              {record.as_white.losses}L ({record.as_white.games} games,{" "}
              {winRate(record.as_white.wins, record.as_white.games)} win rate)
            </div>
            <div className="rounded bg-[var(--color-surface-3)] px-3 py-2">
              As Black: {record.as_black.wins}W-{record.as_black.draws}D-
              {record.as_black.losses}L ({record.as_black.games} games,{" "}
              {winRate(record.as_black.wins, record.as_black.games)} win rate)
            </div>
          </div>
        </div>
      )}

      {/* Openings */}
      {(dossier.openings_as_white.length > 0 ||
        dossier.openings_as_black.length > 0) && (
        <div>
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <BookOpen className="h-4 w-4 text-[var(--color-accent)]" />
            Opening repertoire
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <OpeningTable title="As White" openings={dossier.openings_as_white} />
            <OpeningTable title="As Black" openings={dossier.openings_as_black} />
          </div>
        </div>
      )}

      {/* Recent games */}
      {dossier.recent_games.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Calendar className="h-4 w-4 text-[var(--color-accent)]" />
            Recent games
          </div>
          <div className="space-y-1.5">
            {dossier.recent_games.map((g, i) => (
              <div
                key={`${g.source}-${g.date}-${i}`}
                className="flex items-center gap-3 rounded-lg bg-[var(--color-surface-3)] px-3 py-2 text-xs"
              >
                <span
                  className={`w-4 shrink-0 text-center font-bold ${resultBadge(g.result)}`}
                >
                  {resultLabel(g.result)}
                </span>
                <span className="w-10 shrink-0 capitalize text-[var(--color-muted)]">
                  {g.color}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {g.eco && (
                    <span className="mr-1 font-mono text-[var(--color-accent)]">
                      {g.eco}
                    </span>
                  )}
                  {g.opening}
                </span>
                <span className="shrink-0 text-[var(--color-muted)]">
                  vs {g.opponent}
                </span>
                {g.time_class && (
                  <span className="shrink-0 capitalize text-[var(--color-muted)]">
                    {g.time_class}
                  </span>
                )}
                <span className="shrink-0 text-[var(--color-muted)]">
                  {g.source}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tactical notes */}
      {dossier.tactical_notes && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="mb-1 flex items-center gap-2 font-semibold text-amber-300">
            <Swords className="h-4 w-4" />
            Tactical notes
          </div>
          <p className="text-[var(--color-muted)]">{dossier.tactical_notes}</p>
        </div>
      )}

      {/* Recommended prep */}
      <div className="rounded-lg bg-[var(--color-surface-3)] p-4">
        <div className="font-semibold text-[var(--color-accent)]">
          Recommended prep
        </div>
        <div className="mt-2 space-y-1 whitespace-pre-line text-[var(--color-muted)]">
          {dossier.recommended_prep}
        </div>
      </div>

      {/* AI insight */}
      {dossier.ai_insight && (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-purple-300">
            <Sparkles className="h-4 w-4" />
            AI prep insight
          </div>
          <div className="whitespace-pre-line text-[var(--color-muted)]">
            {dossier.ai_insight}
          </div>
        </div>
      )}

      {/* Import summary */}
      {dossier.games_imported > 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          Imported {dossier.games_imported} games ({importParts.join(", ")}) into
          your database — review them in Analysis.
        </p>
      )}
    </div>
  );
}

function sourceBadge(source: string): string {
  switch (source) {
    case "uscf":
      return "USCF";
    case "fide":
      return "FIDE";
    case "chessgames":
      return "ChessGames";
    case "chesscom":
      return "Chess.com";
    case "lichess":
      return "Lichess";
    default:
      return source;
  }
}

export function OpponentScout() {
  const [uscfId, setUscfId] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [searchSource, setSearchSource] = useState<SearchSource>("uscf");
  const [loading, setLoading] = useState(false);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierStatus, setDossierStatus] = useState<string | null>(null);
  const [member, setMember] = useState<UscfMember | null>(null);
  const [candidates, setCandidates] = useState<OpponentCandidate[]>([]);
  const [dossier, setDossier] = useState<OpponentDossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSource = SEARCH_SOURCES.find((s) => s.id === searchSource)!;

  const lookupById = async () => {
    if (!uscfId.trim()) return;
    setLoading(true);
    setError(null);
    setMember(null);
    setDossier(null);
    try {
      const result = await api.lookupUscf(uscfId.trim());
      setMember(result);
      setCandidates([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const searchByName = async () => {
    if (!nameQuery.trim()) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    setDossier(null);
    setMember(null);
    try {
      const results = await api.searchOpponents(
        nameQuery.trim(),
        SOURCE_IDS[searchSource],
      );
      setCandidates(results);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const buildDossier = async (candidate: OpponentCandidate) => {
    setDossierLoading(true);
    setDossierStatus("Fetching ratings and recent games…");
    setError(null);
    setDossier(null);
    try {
      const d = await api.buildOpponentDossier(candidate);
      setDossier(d);
      setDossierStatus(null);
    } catch (e) {
      setError(String(e));
      setDossierStatus(null);
    } finally {
      setDossierLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="border-b border-[var(--color-border)] px-4 py-5 sm:px-8">
        <h1 className="text-xl font-bold">Opponent Scout</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Search one database at a time to find opponents for tournament prep
        </p>
      </header>

      <div className="space-y-6 p-4 sm:p-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card title="Search by USCF ID">
            <div className="space-y-3">
              <div>
                <Label>USCF Member ID</Label>
                <Input
                  value={uscfId}
                  onChange={(e) => setUscfId(e.target.value)}
                  placeholder="e.g. 12641216"
                  onKeyDown={(e) => e.key === "Enter" && lookupById()}
                />
              </div>
              <Button onClick={lookupById} loading={loading}>
                <Search className="h-4 w-4" />
                Lookup USCF Profile
              </Button>
            </div>
          </Card>

          <Card title="Search by Name">
            <div className="space-y-3">
              <div>
                <Label>Database</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {SEARCH_SOURCES.map((src) => (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => setSearchSource(src.id)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        searchSource === src.id
                          ? "bg-[var(--color-accent)] text-white"
                          : "bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                      }`}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {activeSource.hint}
                </p>
              </div>
              <div>
                <Label>
                  {searchSource === "online"
                    ? "Username"
                    : searchSource === "uscf"
                      ? "Player Name"
                      : "Player Name"}
                </Label>
                <Input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder={
                    searchSource === "uscf"
                      ? "Nakamura, Hikaru or Nakamura"
                      : searchSource === "fide"
                        ? "Carlsen, Magnus"
                        : searchSource === "online"
                          ? "MagnusCarlsen or DrNykterstein"
                          : "Kasparov, Garry"
                  }
                  onKeyDown={(e) => e.key === "Enter" && searchByName()}
                />
              </div>
              <Button onClick={searchByName} loading={loading}>
                <Search className="h-4 w-4" />
                Search {activeSource.label}
              </Button>
            </div>
          </Card>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {(loading || dossierLoading) && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {dossierLoading
              ? dossierStatus ?? "Building dossier…"
              : `Searching ${activeSource.label}…`}
          </div>
        )}

        {candidates.length > 0 && (
          <Card title="Search Results — confirm your opponent">
            <div className="space-y-2">
              {candidates.map((c) => (
                <div
                  key={`${c.source}-${c.id}`}
                  className="flex items-center justify-between rounded-lg bg-[var(--color-surface-3)] px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[var(--color-accent)]">
                        {sourceBadge(c.source)}
                      </span>
                      {c.federation && ` · ${c.federation}`}
                      {c.rating && ` · ${c.rating}`}
                      {c.fide_id && ` · FIDE ${c.fide_id}`}
                      {c.uscf_id && ` · USCF ${c.uscf_id}`}
                      {c.chesscom_username && ` · @${c.chesscom_username}`}
                      {c.lichess_username && ` · @${c.lichess_username}`}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => buildDossier(c)}
                    disabled={loading || dossierLoading}
                  >
                    Build Dossier
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {member && (
          <Card title="USCF Profile">
            <div className="flex items-start gap-4">
              <Shield className="h-10 w-10 text-[var(--color-accent)]" />
              <div className="flex-1">
                <h2 className="text-lg font-bold">
                  {member.first_name} {member.last_name}
                </h2>
                <div className="mt-1 text-sm text-[var(--color-muted)]">
                  USCF #{member.id}
                  {member.state && ` · ${member.state}`}
                  {member.fide_id && ` · FIDE ${member.fide_id}`}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {member.ratings
                    .filter((r) => r.rating != null)
                    .map((r) => (
                      <div
                        key={r.rating_system}
                        className="rounded-lg bg-[var(--color-surface-3)] p-3"
                      >
                        <div className="text-xs text-[var(--color-muted)]">
                          {formatRatingSystem(r.rating_system)}
                        </div>
                        <div className="text-xl font-bold">{r.rating}</div>
                      </div>
                    ))}
                </div>
                <div className="mt-4">
                  <Button
                    onClick={() =>
                      buildDossier({
                        id: `uscf_${member.id}`,
                        name: `${member.first_name} ${member.last_name}`,
                        source: "uscf",
                        rating:
                          member.ratings.find(
                            (r) =>
                              r.rating_system === "R" ||
                              r.rating_system.includes("Regular"),
                          )?.rating ?? null,
                        federation: member.state,
                        fide_id: member.fide_id,
                        uscf_id: member.id,
                        chessgames_id: null,
                        chesscom_username: null,
                        lichess_username: null,
                      })
                    }
                    loading={dossierLoading}
                  >
                    Build Dossier
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {dossier && (
          <Card title={`Dossier — ${dossier.candidate.name}`}>
            <DossierView dossier={dossier} />
          </Card>
        )}
      </div>
    </div>
  );
}
