use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSettings {
    pub chesscom_username: Option<String>,
    pub lichess_username: Option<String>,
    pub uscf_id: Option<String>,
    pub ollama_model: Option<String>,
    pub analysis_depth: Option<u32>,
    pub default_game_count: Option<u32>,
    pub theme: Option<String>,
    pub compact_ui: Option<bool>,
}

impl Default for AccountSettings {
    fn default() -> Self {
        Self {
            chesscom_username: None,
            lichess_username: None,
            uscf_id: None,
            ollama_model: Some("llama3.1".to_string()),
            analysis_depth: Some(18),
            default_game_count: Some(100),
            theme: Some("slate".to_string()),
            compact_ui: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairScoutResult {
    pub fixed: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameRecord {
    pub id: i64,
    pub source: String,
    pub external_id: String,
    pub pgn: String,
    pub white_player: String,
    pub black_player: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    pub result: String,
    pub eco: Option<String>,
    pub opening_name: Option<String>,
    pub time_class: Option<String>,
    pub played_at: Option<String>,
    pub is_own_game: bool,
    #[serde(default)]
    pub analyzed: bool,
    pub avg_cp_loss: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpeningStat {
    pub eco: String,
    pub name: String,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStatsSummary {
    pub total_games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub openings_as_white: Vec<OpeningStat>,
    pub openings_as_black: Vec<OpeningStat>,
    pub by_time_class: Vec<TimeClassStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeClassStat {
    pub time_class: String,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UscfMember {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub state: Option<String>,
    pub fide_id: Option<String>,
    pub status: Option<String>,
    pub ratings: Vec<UscfRating>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UscfRating {
    pub rating_system: String,
    pub rating: Option<i32>,
    pub games_played: Option<i32>,
    pub is_provisional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub connected: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveAnalysis {
    pub move_index: u32,
    pub san: String,
    pub fen: String,
    pub eval_cp: Option<i32>,
    pub best_move_uci: Option<String>,
    pub classification: String,
    pub cp_loss: i32,
    pub is_own_move: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameAnalysis {
    pub game_id: i64,
    pub moves: Vec<MoveAnalysis>,
    /// Absolute White-perspective eval per board index (0 = start, k = after k moves).
    pub position_evals: Vec<Option<i32>>,
    pub avg_cp_loss: f64,
    pub analyzed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    pub game_id: i64,
    pub current: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisSummary {
    pub analyzed_games: u32,
    pub total_blunders: u32,
    pub total_mistakes: u32,
    pub total_inaccuracies: u32,
    pub avg_cp_loss: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlunderPuzzle {
    pub id: String,
    pub game_id: i64,
    pub move_index: u32,
    pub fen: String,
    pub best_move_uci: String,
    pub played_move: String,
    pub cp_loss: i32,
    pub white_player: String,
    pub black_player: String,
    pub opening_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockfishStatus {
    pub available: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpponentCandidate {
    pub id: String,
    pub name: String,
    pub source: String,
    pub rating: Option<i32>,
    pub federation: Option<String>,
    pub fide_id: Option<String>,
    pub uscf_id: Option<String>,
    pub chessgames_id: Option<String>,
    pub chesscom_username: Option<String>,
    pub lichess_username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DossierColorRecord {
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DossierRecord {
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub as_white: DossierColorRecord,
    pub as_black: DossierColorRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DossierOpeningStat {
    pub name: String,
    pub eco: Option<String>,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DossierRecentGame {
    pub opponent: String,
    pub result: String,
    pub opening: String,
    pub eco: Option<String>,
    pub color: String,
    pub date: Option<String>,
    pub source: String,
    pub time_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DossierRatingLine {
    pub label: String,
    pub rating: i32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpponentDossier {
    pub candidate: OpponentCandidate,
    pub games_imported: u32,
    pub games_imported_chesscom: u32,
    pub games_imported_lichess: u32,
    pub games_imported_chessgames: u32,
    pub opening_lines: Vec<String>,
    pub openings_as_white: Vec<DossierOpeningStat>,
    pub openings_as_black: Vec<DossierOpeningStat>,
    pub record: DossierRecord,
    pub recent_games: Vec<DossierRecentGame>,
    pub ratings: Vec<DossierRatingLine>,
    pub style_summary: String,
    pub tactical_notes: String,
    pub recommended_prep: String,
    pub ai_insight: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FidePlayer {
    pub fide_id: String,
    pub name: String,
    pub federation: Option<String>,
    pub standard_rating: Option<i32>,
    pub rapid_rating: Option<i32>,
    pub blitz_rating: Option<i32>,
    pub title: Option<String>,
}
