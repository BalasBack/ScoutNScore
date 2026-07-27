export type ThemeId = "slate" | "midnight" | "forest" | "royal" | "light";

export interface AccountSettings {
  chesscom_username: string | null;
  lichess_username: string | null;
  uscf_id: string | null;
  ollama_model: string | null;
  analysis_depth: number | null;
  default_game_count: number | null;
  theme: ThemeId | null;
  compact_ui: boolean | null;
}

export interface GameRecord {
  id: number;
  source: string;
  external_id: string;
  pgn: string;
  white_player: string;
  black_player: string;
  white_elo: number | null;
  black_elo: number | null;
  result: string;
  eco: string | null;
  opening_name: string | null;
  time_class: string | null;
  played_at: string | null;
  is_own_game: boolean;
  analyzed?: boolean;
  avg_cp_loss?: number | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  source: string;
  message: string;
}

export interface OpeningStat {
  eco: string;
  name: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  color: string;
}

export interface PlayerStatsSummary {
  total_games: number;
  wins: number;
  draws: number;
  losses: number;
  openings_as_white: OpeningStat[];
  openings_as_black: OpeningStat[];
  by_time_class: {
    time_class: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
  }[];
}

export interface UscfRating {
  rating_system: string;
  rating: number | null;
  games_played: number | null;
  is_provisional: boolean;
}

export interface UscfMember {
  id: string;
  first_name: string;
  last_name: string;
  state: string | null;
  fide_id: string | null;
  status: string | null;
  ratings: UscfRating[];
}

export interface UscfRatingSnapshot {
  date: string;
  ratings: UscfRating[];
}

export interface CoachMessage {
  role: string;
  content: string;
}

export interface OllamaStatus {
  connected: boolean;
  models: string[];
  error: string | null;
}

export interface MoveAnalysis {
  move_index: number;
  san: string;
  fen: string;
  eval_cp: number | null;
  best_move_uci: string | null;
  classification: string;
  cp_loss: number;
  is_own_move: boolean;
}

export interface GameAnalysis {
  game_id: number;
  moves: MoveAnalysis[];
  position_evals: (number | null)[];
  avg_cp_loss: number;
  analyzed: boolean;
}

export interface AnalysisProgress {
  game_id: number;
  current: number;
  total: number;
  message: string;
}

export interface AnalysisSummary {
  analyzed_games: number;
  total_blunders: number;
  total_mistakes: number;
  total_inaccuracies: number;
  avg_cp_loss: number;
}

export interface BlunderPuzzle {
  id: string;
  game_id: number;
  move_index: number;
  fen: string;
  best_move_uci: string;
  played_move: string;
  cp_loss: number;
  white_player: string;
  black_player: string;
  opening_name: string | null;
}

export interface StockfishStatus {
  available: boolean;
  path: string | null;
  error: string | null;
}

export interface OpponentCandidate {
  id: string;
  name: string;
  source: string;
  rating: number | null;
  federation: string | null;
  fide_id: string | null;
  uscf_id: string | null;
  chessgames_id: string | null;
  chesscom_username: string | null;
  lichess_username: string | null;
}

export interface DossierColorRecord {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface DossierRecord {
  wins: number;
  draws: number;
  losses: number;
  as_white: DossierColorRecord;
  as_black: DossierColorRecord;
}

export interface DossierOpeningStat {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  color: string;
}

export interface DossierRecentGame {
  opponent: string;
  result: string;
  opening: string;
  eco: string | null;
  color: string;
  date: string | null;
  source: string;
  time_class: string | null;
}

export interface DossierRatingLine {
  label: string;
  rating: number;
  source: string;
}

export interface OpponentDossier {
  candidate: OpponentCandidate;
  games_imported: number;
  games_imported_chesscom: number;
  games_imported_lichess: number;
  games_imported_chessgames: number;
  opening_lines: string[];
  openings_as_white: DossierOpeningStat[];
  openings_as_black: DossierOpeningStat[];
  record: DossierRecord;
  recent_games: DossierRecentGame[];
  ratings: DossierRatingLine[];
  style_summary: string;
  tactical_notes: string;
  recommended_prep: string;
  ai_insight: string | null;
}

export interface RepairScoutResult {
  fixed: number;
  message: string;
}

export type ChessScopeApi = {
  getSettings: () => Promise<AccountSettings>;
  saveSettings: (settings: AccountSettings) => Promise<void>;
  importChesscom: (username: string, maxGames?: number, asOpponent?: boolean) => Promise<ImportResult>;
  importLichess: (username: string, maxGames?: number, asOpponent?: boolean) => Promise<ImportResult>;
  syncAll: () => Promise<ImportResult[]>;
  listGames: (limit?: number, offset?: number, ownOnly?: boolean) => Promise<GameRecord[]>;
  getGameCount: () => Promise<number>;
  getScoutedGameCount: () => Promise<number>;
  getPlayerStats: () => Promise<PlayerStatsSummary>;
  lookupUscf: (uscfId: string) => Promise<UscfMember>;
  checkOllama: () => Promise<OllamaStatus>;
  coachChat: (model: string, messages: CoachMessage[]) => Promise<string>;
  checkStockfish: () => Promise<StockfishStatus>;
  getGameAnalysis: (gameId: number) => Promise<GameAnalysis | null>;
  analyzeGame: (gameId: number) => Promise<GameAnalysis>;
  analyzePendingGames: (limit?: number) => Promise<number>;
  getAnalysisSummary: () => Promise<AnalysisSummary>;
  getBlunderPuzzles: (limit?: number) => Promise<BlunderPuzzle[]>;
  submitPuzzleAttempt: (puzzleId: string, solved: boolean, timeSecs: number) => Promise<void>;
  backfillOpenings: () => Promise<number>;
  searchOpponents: (query: string, sources?: string[]) => Promise<OpponentCandidate[]>;
  buildOpponentDossier: (candidate: OpponentCandidate) => Promise<OpponentDossier>;
  repairScoutGames: () => Promise<RepairScoutResult>;
};
