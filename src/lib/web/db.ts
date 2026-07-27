import type { AccountSettings, GameAnalysis, GameRecord } from "../types";
import { shouldRelabelAsScout } from "../repair-scout-games";

const DB_NAME = "chessscope-web";
const DB_VERSION = 1;

type StoredGame = GameRecord & {
  own_color: string | null;
  analyzed_at: string | null;
  avg_cp_loss: number | null;
  position_evals_json: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("games")) {
        const games = db.createObjectStore("games", {
          keyPath: "id",
          autoIncrement: true,
        });
        games.createIndex("by_source_ext", ["source", "external_id"], {
          unique: true,
        });
      }
      if (!db.objectStoreNames.contains("analysis")) {
        db.createObjectStore("analysis", { keyPath: "game_id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("puzzle_attempts")) {
        db.createObjectStore("puzzle_attempts", { keyPath: "puzzle_id" });
      }
    };
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = fn(s);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getSettings(): Promise<AccountSettings> {
  const row = await tx<{ key: string; value: string } | undefined>(
    "settings",
    "readonly",
    (s) => s.get("account"),
  );
  if (!row?.value) {
    return {
      chesscom_username: null,
      lichess_username: null,
      uscf_id: null,
      ollama_model: "llama3.1",
      analysis_depth: 14,
      default_game_count: 100,
      theme: "slate",
      compact_ui: false,
    };
  }
  return JSON.parse(row.value);
}

export async function saveSettings(settings: AccountSettings): Promise<void> {
  await tx("settings", "readwrite", (s) =>
    s.put({ key: "account", value: JSON.stringify(settings) }),
  );
}

export async function listGames(
  limit = 100,
  offset = 0,
  ownOnly?: boolean,
): Promise<GameRecord[]> {
  const all = await tx<StoredGame[]>("games", "readonly", (s) => s.getAll());
  let filtered = all;
  if (ownOnly === true) filtered = all.filter((g) => g.is_own_game);
  else if (ownOnly === false) filtered = all.filter((g) => !g.is_own_game);
  filtered.sort((a, b) => {
    const da = a.played_at ?? "";
    const db = b.played_at ?? "";
    return db.localeCompare(da);
  });
  return filtered.slice(offset, offset + limit).map(toGameRecord);
}

export async function getGameCount(): Promise<number> {
  const all = await tx<StoredGame[]>("games", "readonly", (s) => s.getAll());
  return all.filter((g) => g.is_own_game).length;
}

export async function getScoutedGameCount(): Promise<number> {
  const all = await tx<StoredGame[]>("games", "readonly", (s) => s.getAll());
  return all.filter((g) => !g.is_own_game).length;
}

export async function getGame(id: number): Promise<StoredGame | null> {
  const g = await tx<StoredGame | undefined>("games", "readonly", (s) =>
    s.get(id),
  );
  return g ?? null;
}

export async function getOwnColor(gameId: number): Promise<string> {
  const g = await getGame(gameId);
  return g?.own_color ?? "white";
}

function toGameRecord(g: StoredGame): GameRecord {
  return {
    id: g.id,
    source: g.source,
    external_id: g.external_id,
    pgn: g.pgn,
    white_player: g.white_player,
    black_player: g.black_player,
    white_elo: g.white_elo,
    black_elo: g.black_elo,
    result: g.result,
    eco: g.eco,
    opening_name: g.opening_name,
    time_class: g.time_class,
    played_at: g.played_at,
    is_own_game: g.is_own_game,
    analyzed: !!g.analyzed_at,
    avg_cp_loss: g.avg_cp_loss,
  };
}

export async function upsertGame(
  game: Omit<StoredGame, "id"> & { id?: number },
): Promise<boolean> {
  const all = await tx<StoredGame[]>("games", "readonly", (s) => s.getAll());
  const existing = all.find(
    (g) => g.source === game.source && g.external_id === game.external_id,
  );
  if (existing) {
    const isOwn = existing.is_own_game || game.is_own_game;
    await tx("games", "readwrite", (s) =>
      s.put({ ...existing, ...game, id: existing.id, is_own_game: isOwn }),
    );
    return false;
  }
  await tx("games", "readwrite", (s) => s.add(game));
  return true;
}

export async function saveAnalysis(
  gameId: number,
  analysis: GameAnalysis,
): Promise<void> {
  await tx("analysis", "readwrite", (s) =>
    s.put({ game_id: gameId, data: analysis }),
  );
  const g = await getGame(gameId);
  if (g) {
    await tx("games", "readwrite", (s) =>
      s.put({
        ...g,
        analyzed_at: new Date().toISOString(),
        avg_cp_loss: analysis.avg_cp_loss,
        position_evals_json: JSON.stringify(analysis.position_evals),
      }),
    );
  }
}

export async function getAnalysis(
  gameId: number,
): Promise<GameAnalysis | null> {
  const row = await tx<{ game_id: number; data: GameAnalysis } | undefined>(
    "analysis",
    "readonly",
    (s) => s.get(gameId),
  );
  return row?.data ?? null;
}

export async function allStoredGames(): Promise<StoredGame[]> {
  return tx("games", "readonly", (s) => s.getAll());
}

export async function recordPuzzleAttempt(
  puzzleId: string,
  solved: boolean,
): Promise<void> {
  await tx("puzzle_attempts", "readwrite", (s) =>
    s.put({ puzzle_id: puzzleId, solved, at: Date.now() }),
  );
}

export async function isPuzzleSolved(puzzleId: string): Promise<boolean> {
  const row = await tx<{ puzzle_id: string; solved: boolean } | undefined>(
    "puzzle_attempts",
    "readonly",
    (s) => s.get(puzzleId),
  );
  return row?.solved ?? false;
}

export async function repairScoutGames(): Promise<{ fixed: number; message: string }> {
  const settings = await getSettings();
  if (!settings.chesscom_username && !settings.lichess_username) {
    return {
      fixed: 0,
      message: "Link your Chess.com or Lichess username first so we can tell your games apart.",
    };
  }
  const all = await allStoredGames();
  let fixed = 0;
  for (const g of all) {
    if (
      shouldRelabelAsScout(
        {
          source: g.source,
          white_player: g.white_player,
          black_player: g.black_player,
          is_own_game: g.is_own_game,
        },
        settings,
      )
    ) {
      await tx("games", "readwrite", (s) =>
        s.put({ ...g, is_own_game: false }),
      );
      fixed++;
    }
  }
  return {
    fixed,
    message:
      fixed > 0
        ? `Relabeled ${fixed} game(s) as scouted opponent games. Your dashboard stats are updated.`
        : "No mislabeled scout games found — everything looks correct.",
  };
}

export type { StoredGame };
