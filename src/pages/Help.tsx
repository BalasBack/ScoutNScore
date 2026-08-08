import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  MessageSquare,
  Dumbbell,
  Search,
  Award,
  Settings,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { isWebApp } from "../lib/api";
import { Card } from "../components/ui";

type Step = {
  title: string;
  body: string;
  to?: string;
  linkLabel?: string;
  icon?: LucideIcon;
};

function SectionLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
    >
      Open {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

export function Help() {
  const web = isWebApp();

  const quickStart: Step[] = [
    {
      title: "1. Link your accounts",
      body: "Open Settings and enter your Chess.com and/or Lichess username. Optionally add your USCF ID.",
      to: "/settings",
      linkLabel: "Settings",
      icon: Settings,
    },
    {
      title: "2. Sync your games",
      body: "On the Dashboard, click Sync games. ScoutNScore imports recent games from your linked accounts (not opponent scout imports).",
      to: "/",
      linkLabel: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "3. Run Stockfish analysis",
      body: "Click Analyze pending on the Dashboard (or analyze from Analysis). Blunders and inaccuracies feed Training and Coach advice.",
      to: "/analysis",
      linkLabel: "Analysis",
      icon: BarChart3,
    },
    {
      title: "4. Prep for events",
      body: "Use AI Coach for a plan, Training for blunder puzzles, Opponent Scout before a round, and USCF Profile for rating-aware tips.",
    },
  ];

  const features: Step[] = [
    {
      title: "Dashboard",
      body: "Overview of your win rate, openings, and analysis progress. Sync and analyze from here. Metrics use your games only.",
      to: "/",
      icon: LayoutDashboard,
    },
    {
      title: "Analysis",
      body: "Browse My games vs Scouted opponents. Open a game to review Stockfish evals and move quality.",
      to: "/analysis",
      icon: BarChart3,
    },
    {
      title: "AI Coach",
      body: web
        ? "Ask tournament-prep questions. On the website, replies come from a free cloud coach (no signup). Import games first so advice uses your stats."
        : "Ask tournament-prep questions powered by local Ollama. Install Ollama, pull a model (e.g. llama3.1), then pick it in Settings.",
      to: "/coach",
      icon: MessageSquare,
    },
    {
      title: "Training",
      body: "Practice positions from your own analyzed blunders. Analyze more games if the puzzle queue is empty.",
      to: "/training",
      icon: Dumbbell,
    },
    {
      title: "Opponent Scout",
      body: "Search USCF, FIDE, Online Accounts (Lichess/Chess.com), or Chessgames.com. Build a dossier and import their games separately from yours.",
      to: "/scout",
      icon: Search,
    },
    {
      title: "USCF Profile",
      body: "Look up a USCF member, view ratings and trends, and get prep suggestions tied to your online stats.",
      to: "/uscf",
      icon: Award,
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="page-header border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--color-surface-2)] to-transparent px-4 py-5 sm:px-8">
        <h1 className="text-xl font-bold">Help</h1>
        <p className="text-sm text-[var(--color-muted)]">
          How to use ScoutNScore for Chess Tournament Prep
          {web ? " (Web Edition)" : " (Desktop Edition)"}
        </p>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-8">
        <Card title="Quick Start">
          <ol className="space-y-4">
            {quickStart.map((step) => (
              <li key={step.title} className="flex gap-3">
                {step.icon && (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                    <step.icon className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">{step.title}</div>
                  <p className="text-sm text-[var(--color-muted)]">{step.body}</p>
                  {step.to && step.linkLabel && (
                    <SectionLink to={step.to} label={step.linkLabel} />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="What Each Page Does">
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex gap-3">
                {f.icon && (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-[var(--color-muted)]">
                    <f.icon className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">{f.title}</div>
                  <p className="text-sm text-[var(--color-muted)]">{f.body}</p>
                  {f.to && <SectionLink to={f.to} label={f.title} />}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={web ? "Web vs Desktop" : "Desktop vs Web"}>
          <div className="space-y-3 text-sm text-[var(--color-muted)]">
            {web ? (
              <>
                <p>
                  <strong className="text-[var(--color-text)]">This website</strong> stores
                  games in this browser (IndexedDB). Clearing site data removes them. Stockfish
                  runs in WASM; the first engine check may download a few MB.
                </p>
                <p>
                  <strong className="text-[var(--color-text)]">Desktop app</strong> keeps a
                  local database, uses a native Stockfish binary, and can run a stronger AI
                  Coach via{" "}
                  <a
                    href="https://ollama.com"
                    className="text-[var(--color-accent)] underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ollama
                  </a>
                  .{" "}
                  <a
                    href="https://github.com/BalasBack/ScoutNScore/releases"
                    className="text-[var(--color-accent)] underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download releases
                  </a>
                  .
                </p>
              </>
            ) : (
              <>
                <p>
                  <strong className="text-[var(--color-text)]">This desktop app</strong> stores
                  data locally and uses native Stockfish. AI Coach needs Ollama running
                  (Settings shows connection status).
                </p>
                <p>
                  The <strong className="text-[var(--color-text)]">website</strong> edition works
                  in any browser with no install — handy for quick prep — but games stay in that
                  browser and coaching uses the free cloud coach.
                </p>
              </>
            )}
            <p>
              <a
                href="https://balasback.github.io/ScoutNScore/privacy.html"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Read the Privacy Policy
              </a>
            </p>
          </div>
        </Card>

        <Card title="Tips & Troubleshooting">
          <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--color-muted)]">
            <li>
              <strong className="text-[var(--color-text)]">Own games vs scouted:</strong>{" "}
              Dashboard and personal stats ignore opponent imports. Use Analysis tabs or Opponent
              Scout for scouted games. If labels look wrong, Settings → Fix mislabeled scout
              games.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Stockfish:</strong>{" "}
              {web
                ? "Settings should show Ready after the WASM loads. Hard-refresh (Ctrl+Shift+R) if it times out on first visit."
                : "If not found, run the Stockfish download script from the project docs / Settings hint."}
            </li>
            {!web && (
              <li>
                <strong className="text-[var(--color-text)]">Ollama:</strong> Start the Ollama
                app, pull a model, then Refresh in Settings. Prefer{" "}
                <code className="rounded bg-[var(--color-surface-3)] px-1 text-xs">
                  127.0.0.1
                </code>{" "}
                if localhost fails.
              </li>
            )}
            <li>
              <strong className="text-[var(--color-text)]">Empty Training:</strong> Analyze games
              with Stockfish so blunders become puzzles.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">Appearance:</strong> Themes and compact
              layout live in Settings → Appearance.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
