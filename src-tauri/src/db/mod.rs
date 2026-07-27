mod schema;

use crate::models::{AccountSettings, AnalysisSummary, BlunderPuzzle, GameAnalysis, GameRecord, MoveAnalysis, OpeningStat, PlayerStatsSummary, TimeClassStat};
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open() -> SqlResult<Self> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)?;
        schema::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn get_settings(&self) -> SqlResult<AccountSettings> {
        let conn = self.conn.lock().unwrap();
        let mut settings = AccountSettings::default();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "chesscom_username" => settings.chesscom_username = Some(value),
                "lichess_username" => settings.lichess_username = Some(value),
                "uscf_id" => settings.uscf_id = Some(value),
                "ollama_model" => settings.ollama_model = Some(value),
                "analysis_depth" => settings.analysis_depth = value.parse().ok(),
                "default_game_count" => settings.default_game_count = value.parse().ok(),
                "theme" => settings.theme = Some(value),
                "compact_ui" => settings.compact_ui = value.parse().ok(),
                _ => {}
            }
        }
        Ok(settings)
    }

    pub fn save_settings(&self, settings: &AccountSettings) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let pairs = [
            ("chesscom_username", settings.chesscom_username.clone()),
            ("lichess_username", settings.lichess_username.clone()),
            ("uscf_id", settings.uscf_id.clone()),
            ("ollama_model", settings.ollama_model.clone()),
            ("analysis_depth", settings.analysis_depth.map(|v| v.to_string())),
            (
                "default_game_count",
                settings.default_game_count.map(|v| v.to_string()),
            ),
            ("theme", settings.theme.clone()),
            (
                "compact_ui",
                settings.compact_ui.map(|v| v.to_string()),
            ),
        ];
        for (key, value) in pairs {
            if let Some(v) = value {
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key, v],
                )?;
            }
        }
        Ok(())
    }

    pub fn upsert_game(
        &self,
        source: &str,
        external_id: &str,
        pgn: &str,
        white: &str,
        black: &str,
        white_elo: Option<i32>,
        black_elo: Option<i32>,
        result: &str,
        eco: Option<&str>,
        opening_name: Option<&str>,
        time_class: Option<&str>,
        played_at: Option<&str>,
        is_own_game: bool,
        own_color: Option<&str>,
    ) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let _rows = conn.execute(
            "INSERT INTO games (
                source, external_id, pgn, white_player, black_player,
                white_elo, black_elo, result, eco, opening_name,
                time_class, played_at, is_own_game, own_color
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
            ON CONFLICT(source, external_id) DO UPDATE SET
                pgn = excluded.pgn,
                white_elo = COALESCE(excluded.white_elo, games.white_elo),
                black_elo = COALESCE(excluded.black_elo, games.black_elo),
                result = excluded.result,
                eco = COALESCE(excluded.eco, games.eco),
                opening_name = COALESCE(excluded.opening_name, games.opening_name),
                time_class = COALESCE(excluded.time_class, games.time_class),
                played_at = COALESCE(excluded.played_at, games.played_at),
                own_color = COALESCE(excluded.own_color, games.own_color),
                is_own_game = MAX(games.is_own_game, excluded.is_own_game)",
            params![
                source,
                external_id,
                pgn,
                white,
                black,
                white_elo,
                black_elo,
                result,
                eco,
                opening_name,
                time_class,
                played_at,
                is_own_game as i32,
                own_color
            ],
        )?;
        Ok(true)
    }

    pub fn list_games(&self, limit: u32, offset: u32, own_only: Option<bool>) -> SqlResult<Vec<GameRecord>> {
        let conn = self.conn.lock().unwrap();
        let filter = match own_only {
            Some(true) => " WHERE is_own_game = 1",
            Some(false) => " WHERE is_own_game = 0",
            None => "",
        };
        let sql = format!(
            "SELECT id, source, external_id, pgn, white_player, black_player,
                    white_elo, black_elo, result, eco, opening_name,
                    time_class, played_at, is_own_game, analyzed_at, avg_cp_loss
             FROM games{filter} ORDER BY played_at DESC NULLS LAST, id DESC
             LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![limit, offset], |row| {
            let analyzed_at: Option<String> = row.get(14)?;
            Ok(GameRecord {
                id: row.get(0)?,
                source: row.get(1)?,
                external_id: row.get(2)?,
                pgn: row.get(3)?,
                white_player: row.get(4)?,
                black_player: row.get(5)?,
                white_elo: row.get(6)?,
                black_elo: row.get(7)?,
                result: row.get(8)?,
                eco: row.get(9)?,
                opening_name: row.get(10)?,
                time_class: row.get(11)?,
                played_at: row.get(12)?,
                is_own_game: row.get::<_, i32>(13)? != 0,
                analyzed: analyzed_at.is_some(),
                avg_cp_loss: row.get(15)?,
            })
        })?;
        rows.collect()
    }

    pub fn count_games(&self) -> SqlResult<u32> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u32)
    }

    pub fn count_scouted_games(&self) -> SqlResult<u32> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 0",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u32)
    }

    pub fn repair_scout_games(&self) -> SqlResult<crate::models::RepairScoutResult> {
        let settings = self.get_settings()?;
        if settings.chesscom_username.is_none() && settings.lichess_username.is_none() {
            return Ok(crate::models::RepairScoutResult {
                fixed: 0,
                message: "Link your Chess.com or Lichess username first so we can tell your games apart.".to_string(),
            });
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, source, white_player, black_player FROM games WHERE is_own_game = 1",
        )?;
        let rows: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut fixed = 0u32;
        for (id, source, white, black) in rows {
            if Self::should_relabel_as_scout(&source, &white, &black, &settings) {
                conn.execute(
                    "UPDATE games SET is_own_game = 0 WHERE id = ?1",
                    params![id],
                )?;
                fixed += 1;
            }
        }

        let message = if fixed > 0 {
            format!(
                "Relabeled {fixed} game(s) as scouted opponent games. Your dashboard stats are updated."
            )
        } else {
            "No mislabeled scout games found — everything looks correct.".to_string()
        };

        Ok(crate::models::RepairScoutResult { fixed, message })
    }

    fn name_matches(player: &str, username: &str) -> bool {
        player.trim().eq_ignore_ascii_case(username.trim())
    }

    fn player_is_user(white: &str, black: &str, username: &Option<String>) -> bool {
        username
            .as_ref()
            .is_some_and(|u| Self::name_matches(white, u) || Self::name_matches(black, u))
    }

    fn should_relabel_as_scout(
        source: &str,
        white: &str,
        black: &str,
        settings: &AccountSettings,
    ) -> bool {
        let chesscom = &settings.chesscom_username;
        let lichess = &settings.lichess_username;

        if source == "chessgames" {
            return true;
        }

        if source == "chesscom" {
            if let Some(u) = chesscom {
                return !Self::player_is_user(white, black, &Some(u.clone()));
            }
            if let Some(u) = lichess {
                return !Self::player_is_user(white, black, &Some(u.clone()));
            }
        }

        if source == "lichess" {
            if let Some(u) = lichess {
                return !Self::player_is_user(white, black, &Some(u.clone()));
            }
            if let Some(u) = chesscom {
                return !Self::player_is_user(white, black, &Some(u.clone()));
            }
        }

        false
    }

    pub fn player_stats(&self) -> SqlResult<PlayerStatsSummary> {
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM games WHERE is_own_game = 1", [], |r| r.get(0))?;
        let wins: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 1 AND result = 'win'",
            [],
            |r| r.get(0),
        ).unwrap_or(0);
        let draws: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 1 AND result = 'draw'",
            [],
            |r| r.get(0),
        ).unwrap_or(0);
        let losses: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 1 AND result = 'loss'",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        let openings_white = Self::opening_stats(&conn, "white")?;
        let openings_black = Self::opening_stats(&conn, "black")?;
        let by_time_class = Self::time_class_stats(&conn)?;

        Ok(PlayerStatsSummary {
            total_games: total as u32,
            wins: wins as u32,
            draws: draws as u32,
            losses: losses as u32,
            openings_as_white: openings_white,
            openings_as_black: openings_black,
            by_time_class,
        })
    }

    fn opening_stats(conn: &Connection, color: &str) -> SqlResult<Vec<OpeningStat>> {
        let mut stmt = conn.prepare(
            "SELECT COALESCE(eco, '???') as eco,
                    COUNT(*) as games,
                    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) as draws,
                    SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
             FROM games
             WHERE is_own_game = 1 AND own_color = ?1
             GROUP BY COALESCE(eco, '???')
             ORDER BY games DESC
             LIMIT 10",
        )?;
        let rows = stmt.query_map([color], |row| {
            let eco: String = row.get(0)?;
            Ok(OpeningStat {
                eco: eco.clone(),
                name: String::new(),
                games: row.get::<_, i64>(1)? as u32,
                wins: row.get::<_, i64>(2)? as u32,
                draws: row.get::<_, i64>(3)? as u32,
                losses: row.get::<_, i64>(4)? as u32,
                color: color.to_string(),
            })
        })?;
        let mut stats: Vec<OpeningStat> = rows.collect::<Result<Vec<_>, _>>()?;
        for stat in &mut stats {
            stat.name = Self::resolve_opening_display_name(conn, color, &stat.eco)?;
        }
        Ok(stats)
    }

    fn resolve_opening_display_name(
        conn: &Connection,
        color: &str,
        eco: &str,
    ) -> SqlResult<String> {
        if eco != "???" {
            if let Some(name) = crate::import::pgn_meta::eco_to_name(eco) {
                return Ok(name.to_string());
            }
        }

        let stored: Option<String> = conn
            .query_row(
                "SELECT opening_name FROM games
                 WHERE is_own_game = 1 AND own_color = ?1
                   AND COALESCE(eco, '???') = ?2
                   AND opening_name IS NOT NULL AND opening_name != ''
                   AND opening_name != 'Unknown'
                   AND opening_name NOT LIKE 'http%'
                 LIMIT 1",
                rusqlite::params![color, eco],
                |r| r.get(0),
            )
            .ok();
        if let Some(ref n) = stored {
            if let Some(clean) = crate::import::pgn_meta::sanitize_opening_label(n) {
                return Ok(clean);
            }
        }

        let pgn: Option<String> = conn
            .query_row(
                "SELECT pgn FROM games
                 WHERE is_own_game = 1 AND own_color = ?1
                   AND COALESCE(eco, '???') = ?2 AND pgn != ''
                 LIMIT 1",
                rusqlite::params![color, eco],
                |r| r.get(0),
            )
            .ok();
        if let Some(pgn) = pgn {
            let eco_opt = if eco == "???" { None } else { Some(eco) };
            let (_, name) =
                crate::import::pgn_meta::resolve_opening(eco_opt, stored.as_deref(), &pgn);
            if let Some(n) = name {
                return Ok(n);
            }
        }

        Ok(if eco == "???" {
            "Unknown".to_string()
        } else {
            eco.to_string()
        })
    }

    fn time_class_stats(conn: &Connection) -> SqlResult<Vec<TimeClassStat>> {
        let mut stmt = conn.prepare(
            "SELECT COALESCE(time_class, 'unknown'), COUNT(*),
                    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END)
             FROM games WHERE is_own_game = 1
             GROUP BY time_class ORDER BY COUNT(*) DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let games: i64 = row.get(1)?;
            Ok(TimeClassStat {
                time_class: row.get(0)?,
                games: games as u32,
                wins: row.get::<_, i64>(2)? as u32,
                draws: row.get::<_, i64>(3)? as u32,
                losses: row.get::<_, i64>(4)? as u32,
            })
        })?;
        rows.collect()
    }

    pub fn backfill_openings(&self) -> SqlResult<u32> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, pgn, eco, opening_name FROM games WHERE pgn != ''",
        )?;
        let rows: Vec<(i64, String, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<Result<_, _>>()?;

        let mut updated = 0u32;
        for (id, pgn, eco, opening_name) in rows {
            let (new_eco, new_opening) =
                crate::import::pgn_meta::resolve_opening(eco.as_deref(), opening_name.as_deref(), &pgn);
            let opening_was_url = opening_name
                .as_deref()
                .is_some_and(|n| n.starts_with("http"));
            let opening_was_eco = opening_name
                .as_deref()
                .is_some_and(crate::import::pgn_meta::is_eco_code);
            let opening_was_moves = opening_name
                .as_deref()
                .is_some_and(crate::import::pgn_meta::is_move_line);
            let opening_unknown = opening_name
                .as_deref()
                .map(|n| n.eq_ignore_ascii_case("unknown"))
                .unwrap_or(true);
            if new_opening.is_some()
                || new_eco.is_some()
                || opening_was_url
                || opening_was_eco
                || opening_was_moves
                || opening_unknown
            {
                conn.execute(
                    "UPDATE games SET
                        eco = COALESCE(?1, eco),
                        opening_name = CASE
                            WHEN ?2 IS NOT NULL THEN ?2
                            WHEN opening_name LIKE 'http%' THEN NULL
                            WHEN opening_name GLOB '[A-E][0-9][0-9]' THEN NULL
                            WHEN opening_name GLOB '[A-E][0-9][0-9]-*' THEN NULL
                            WHEN opening_name GLOB '1.*' THEN NULL
                            WHEN opening_name = 'Unknown' THEN NULL
                            ELSE opening_name
                        END
                     WHERE id = ?3",
                    params![new_eco, new_opening, id],
                )?;
                updated += 1;
            }
        }
        Ok(updated)
    }

    pub fn save_uscf_profile(&self, member: &crate::models::UscfMember) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let ratings_json = serde_json::to_string(&member.ratings).unwrap_or_default();
        conn.execute(
            "INSERT INTO uscf_profiles (uscf_id, first_name, last_name, state, fide_id, status, ratings_json, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7, datetime('now'))
             ON CONFLICT(uscf_id) DO UPDATE SET
                first_name=excluded.first_name, last_name=excluded.last_name,
                state=excluded.state, fide_id=excluded.fide_id,
                status=excluded.status, ratings_json=excluded.ratings_json,
                synced_at=datetime('now')",
            params![
                member.id,
                member.first_name,
                member.last_name,
                member.state,
                member.fide_id,
                member.status,
                ratings_json
            ],
        )?;
        Ok(())
    }

    pub fn get_game(&self, game_id: i64) -> SqlResult<GameRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, source, external_id, pgn, white_player, black_player,
                    white_elo, black_elo, result, eco, opening_name,
                    time_class, played_at, is_own_game, analyzed_at, avg_cp_loss
             FROM games WHERE id = ?1",
            [game_id],
            |row| {
                let analyzed_at: Option<String> = row.get(14)?;
                Ok(GameRecord {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    external_id: row.get(2)?,
                    pgn: row.get(3)?,
                    white_player: row.get(4)?,
                    black_player: row.get(5)?,
                    white_elo: row.get(6)?,
                    black_elo: row.get(7)?,
                    result: row.get(8)?,
                    eco: row.get(9)?,
                    opening_name: row.get(10)?,
                    time_class: row.get(11)?,
                    played_at: row.get(12)?,
                    is_own_game: row.get::<_, i32>(13)? != 0,
                    analyzed: analyzed_at.is_some(),
                    avg_cp_loss: row.get(15)?,
                })
            },
        )
    }

    pub fn get_own_color(&self, game_id: i64) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT own_color FROM games WHERE id = ?1",
            [game_id],
            |row| row.get(0),
        )
    }

    pub fn get_unanalyzed_game_ids(&self, limit: u32) -> SqlResult<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id FROM games
             WHERE is_own_game = 1 AND analyzed_at IS NULL
             ORDER BY played_at DESC NULLS LAST, id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| row.get(0))?;
        rows.collect()
    }

    pub fn save_game_analysis(
        &self,
        game_id: i64,
        moves: &[MoveAnalysis],
        position_evals: &[Option<i32>],
        avg_cp_loss: f64,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM analysis_moves WHERE game_id = ?1",
            [game_id],
        )?;
        for mv in moves {
            conn.execute(
                "INSERT INTO analysis_moves (
                    game_id, move_index, san, fen, eval_cp, best_move_uci,
                    classification, cp_loss, is_own_move
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    game_id,
                    mv.move_index,
                    mv.san,
                    mv.fen,
                    mv.eval_cp,
                    mv.best_move_uci,
                    mv.classification,
                    mv.cp_loss,
                    mv.is_own_move as i32
                ],
            )?;
        }
        let evals_json = serde_json::to_string(position_evals).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE games SET analyzed_at = datetime('now'), avg_cp_loss = ?1, position_evals_json = ?2 WHERE id = ?3",
            params![avg_cp_loss, evals_json, game_id],
        )?;
        Ok(())
    }

    pub fn get_game_analysis(&self, game_id: i64) -> SqlResult<Option<GameAnalysis>> {
        let conn = self.conn.lock().unwrap();
        let analyzed: Option<String> = conn.query_row(
            "SELECT analyzed_at FROM games WHERE id = ?1",
            [game_id],
            |row| row.get(0),
        )?;
        if analyzed.is_none() {
            return Ok(None);
        }
        let avg_cp_loss: Option<f64> = conn.query_row(
            "SELECT avg_cp_loss FROM games WHERE id = ?1",
            [game_id],
            |row| row.get(0),
        )?;
        let position_evals_json: Option<String> = conn
            .query_row(
                "SELECT position_evals_json FROM games WHERE id = ?1",
                [game_id],
                |row| row.get(0),
            )
            .unwrap_or(None);
        let mut stmt = conn.prepare(
            "SELECT move_index, san, fen, eval_cp, best_move_uci, classification, cp_loss, is_own_move
             FROM analysis_moves WHERE game_id = ?1 ORDER BY move_index",
        )?;
        let rows = stmt.query_map([game_id], |row| {
            Ok(MoveAnalysis {
                move_index: row.get::<_, i64>(0)? as u32,
                san: row.get(1)?,
                fen: row.get(2)?,
                eval_cp: row.get(3)?,
                best_move_uci: row.get(4)?,
                classification: row.get(5)?,
                cp_loss: row.get(6)?,
                is_own_move: row.get::<_, i32>(7)? != 0,
            })
        })?;
        let move_list: Vec<MoveAnalysis> = rows.collect::<Result<Vec<_>, _>>()?;
        let position_evals = position_evals_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_else(|| Self::legacy_position_evals(&move_list));
        Ok(Some(GameAnalysis {
            game_id,
            moves: move_list,
            position_evals,
            avg_cp_loss: avg_cp_loss.unwrap_or(0.0),
            analyzed: true,
        }))
    }

    fn legacy_position_evals(moves: &[MoveAnalysis]) -> Vec<Option<i32>> {
        let mut evals = vec![None];
        for m in moves {
            evals.push(m.eval_cp);
        }
        evals
    }

    pub fn analysis_summary(&self) -> SqlResult<AnalysisSummary> {
        let conn = self.conn.lock().unwrap();
        let analyzed_games: i64 = conn.query_row(
            "SELECT COUNT(*) FROM games WHERE is_own_game = 1 AND analyzed_at IS NOT NULL",
            [],
            |r| r.get(0),
        )?;
        let total_blunders: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_moves am
             JOIN games g ON g.id = am.game_id
             WHERE g.is_own_game = 1 AND am.is_own_move = 1 AND am.classification = 'blunder'",
            [],
            |r| r.get(0),
        )?;
        let total_mistakes: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_moves am
             JOIN games g ON g.id = am.game_id
             WHERE g.is_own_game = 1 AND am.is_own_move = 1 AND am.classification = 'mistake'",
            [],
            |r| r.get(0),
        )?;
        let total_inaccuracies: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analysis_moves am
             JOIN games g ON g.id = am.game_id
             WHERE g.is_own_game = 1 AND am.is_own_move = 1 AND am.classification = 'inaccuracy'",
            [],
            |r| r.get(0),
        )?;
        let avg_cp_loss: Option<f64> = conn
            .query_row(
                "SELECT AVG(avg_cp_loss) FROM games WHERE is_own_game = 1 AND analyzed_at IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .ok();

        Ok(AnalysisSummary {
            analyzed_games: analyzed_games as u32,
            total_blunders: total_blunders as u32,
            total_mistakes: total_mistakes as u32,
            total_inaccuracies: total_inaccuracies as u32,
            avg_cp_loss: avg_cp_loss.unwrap_or(0.0),
        })
    }

    pub fn get_blunder_puzzles(&self, limit: u32) -> SqlResult<Vec<BlunderPuzzle>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT am.game_id, am.move_index, am.fen, am.best_move_uci, am.san, am.cp_loss,
                    g.white_player, g.black_player, g.opening_name
             FROM analysis_moves am
             JOIN games g ON g.id = am.game_id
             WHERE g.is_own_game = 1 AND am.is_own_move = 1
               AND am.classification IN ('blunder', 'mistake')
               AND am.best_move_uci IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM puzzle_attempts pa
                 WHERE pa.puzzle_id = am.game_id || '-' || am.move_index
                   AND pa.solved = 1
               )
             ORDER BY RANDOM()
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok(BlunderPuzzle {
                id: format!("{}-{}", row.get::<_, i64>(0)?, row.get::<_, i64>(1)?),
                game_id: row.get(0)?,
                move_index: row.get::<_, i64>(1)? as u32,
                fen: row.get(2)?,
                best_move_uci: row.get(3)?,
                played_move: row.get(4)?,
                cp_loss: row.get(5)?,
                white_player: row.get(6)?,
                black_player: row.get(7)?,
                opening_name: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    pub fn record_puzzle_attempt(&self, puzzle_id: &str, solved: bool, time_secs: u32) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts (puzzle_id, solved, time_secs) VALUES (?1,?2,?3)",
            params![puzzle_id, solved as i32, time_secs],
        )?;
        Ok(())
    }
}

fn db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ChessScope")
        .join("chessscope.db")
}
