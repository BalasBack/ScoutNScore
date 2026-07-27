import { useEffect, useState } from "react";
import { Save, CheckCircle, Palette, Wrench } from "lucide-react";
import { api, AccountSettings, OllamaStatus, StockfishStatus } from "../lib/tauri";
import { isWebApp } from "../lib/api";
import { useTheme } from "../components/ThemeProvider";
import { THEME_OPTIONS } from "../lib/theme";
import { Button, Card, Input, Label } from "../components/ui";

export function SettingsPage() {
  const { theme, compact, setTheme, setCompact } = useTheme();
  const [settings, setSettings] = useState<AccountSettings>({
    chesscom_username: null,
    lichess_username: null,
    uscf_id: null,
    ollama_model: "llama3.1",
    analysis_depth: 18,
    default_game_count: 100,
    theme: "slate",
    compact_ui: false,
  });
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [stockfish, setStockfish] = useState<StockfishStatus | null>(null);
  const [stockfishChecking, setStockfishChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  useEffect(() => {
    refreshStatus();
    api.getSettings().then(setSettings);
  }, []);

  const refreshStatus = () => {
    api.checkOllama().then(setOllama);
    setStockfishChecking(true);
    api
      .checkStockfish()
      .then(setStockfish)
      .finally(() => setStockfishChecking(false));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.saveSettings({
        ...settings,
        theme,
        compact_ui: compact,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof AccountSettings, value: string | number | boolean) => {
    setSettings((s) => ({
      ...s,
      [key]: value === "" || value === null ? null : value,
    }));
  };

  const repairScoutGames = async () => {
    setRepairing(true);
    setRepairMsg(null);
    try {
      await api.saveSettings({
        ...settings,
        theme,
        compact_ui: compact,
      });
      const result = await api.repairScoutGames();
      setRepairMsg(result.message);
    } catch (e) {
      setRepairMsg(String(e));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="page-header border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--color-surface-2)] to-transparent px-4 py-5 sm:px-8">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Appearance, your accounts, and analysis preferences
        </p>
      </header>

      <div className="mx-auto w-full max-w-xl space-y-6 p-4 sm:p-8">
        <Card title="Appearance">
          <div className="space-y-4">
            <div>
              <Label>Color theme</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                      theme === t.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Palette className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                      {t.label}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
                className="rounded border-[var(--color-border)]"
              />
              Compact layout (smaller headers)
            </label>
          </div>
        </Card>

        <Card title="My accounts (your stats)">
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Games synced here count toward <strong>your</strong> dashboard win rate, openings, and
            training puzzles. Opponent games are imported separately via{" "}
            <strong>Opponent Scout</strong> and never mix with your stats.
          </p>
          <div className="space-y-4">
            <div>
              <Label>Chess.com Username</Label>
              <Input
                value={settings.chesscom_username ?? ""}
                onChange={(e) => update("chesscom_username", e.target.value)}
                placeholder="your_chesscom_handle"
              />
            </div>
            <div>
              <Label>Lichess Username</Label>
              <Input
                value={settings.lichess_username ?? ""}
                onChange={(e) => update("lichess_username", e.target.value)}
                placeholder="your_lichess_handle"
              />
            </div>
            <div>
              <Label>USCF Member ID</Label>
              <Input
                value={settings.uscf_id ?? ""}
                onChange={(e) => update("uscf_id", e.target.value)}
                placeholder="12345678"
              />
            </div>
          </div>
        </Card>

        <Card title="Fix scout game labels">
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            If opponent games from Scout were imported before the separation fix, they may still
            count toward your stats. This moves any game that doesn&apos;t match your linked
            usernames to <strong>Scouted</strong> (Analysis → Scouted tab).
          </p>
          <Button
            variant="secondary"
            onClick={repairScoutGames}
            loading={repairing}
            className="w-full"
          >
            <Wrench className="h-4 w-4" />
            Fix mislabeled scout games
          </Button>
          {repairMsg && (
            <p
              className={`mt-3 text-sm ${
                repairMsg.includes("Relabeled")
                  ? "text-emerald-400"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {repairMsg}
            </p>
          )}
        </Card>

        <Card title="Analysis preferences">
          <div className="space-y-4">
            <div>
              <Label>Games to import per sync (your accounts)</Label>
              <Input
                type="number"
                min={10}
                max={500}
                value={settings.default_game_count ?? 100}
                onChange={(e) =>
                  update("default_game_count", parseInt(e.target.value) || 100)
                }
              />
            </div>
            <div>
              <Label>Stockfish analysis depth</Label>
              <Input
                type="number"
                min={10}
                max={30}
                value={settings.analysis_depth ?? 18}
                onChange={(e) =>
                  update("analysis_depth", parseInt(e.target.value) || 18)
                }
              />
            </div>
          </div>
        </Card>

        <Card
          title="Stockfish engine"
          action={
            <Button variant="ghost" onClick={refreshStatus} className="text-xs px-2 py-1">
              Refresh
            </Button>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {stockfishChecking ? (
                <span className="text-[var(--color-muted)]">Checking…</span>
              ) : stockfish?.available ? (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-400">Ready</span>
                </>
              ) : (
                <span className="text-amber-400">
                  {stockfish?.error ?? "Not found"}
                </span>
              )}
            </div>
            {stockfish?.path && (
              <p className="text-xs text-[var(--color-muted)] break-all">
                {stockfish.path}
              </p>
            )}
            {!stockfishChecking && !stockfish?.available && (
              <p className="text-xs text-[var(--color-muted)]">
                {isWebApp()
                  ? "Hard-refresh (Ctrl+Shift+R). If this persists, the site needs a fresh deploy (npm run build:web + push)."
                  : "Run: powershell scripts/download-stockfish.ps1"}
              </p>
            )}
          </div>
        </Card>

        <Card
          title={isWebApp() ? "AI coach (free cloud)" : "AI coach (Ollama)"}
          action={
            <Button variant="ghost" onClick={refreshStatus} className="text-xs px-2 py-1">
              Refresh
            </Button>
          }
        >
          <div className="space-y-3">
            {isWebApp() ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {ollama?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-400">Ready</span>
                    </>
                  ) : (
                    <span className="text-amber-400">
                      {ollama?.error ?? "Checking…"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-muted)]">
                  Free cloud coach — no signup required. Tries several free models with automatic retry.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {ollama?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-400">Connected</span>
                    </>
                  ) : (
                    <span className="text-amber-400">
                      {ollama?.error ??
                        "Not connected — open the Ollama app from the Start menu, then click Refresh"}
                    </span>
                  )}
                </div>
                <div>
                  <Label>Default model</Label>
                  <Input
                    value={settings.ollama_model ?? "llama3.1"}
                    onChange={(e) => update("ollama_model", e.target.value)}
                    placeholder="llama3.1"
                  />
                </div>
              </>
            )}
          </div>
        </Card>

        <Button onClick={save} loading={saving} className="w-full">
          {saved ? (
            <>
              <CheckCircle className="h-4 w-4" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
