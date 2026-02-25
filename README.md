# 🚀 WebsiteForge

Automated lead generation pipeline that finds local businesses with bad/missing websites, generates stunning demo landing pages, deploys them to GitHub Pages, and logs everything to Google Sheets for review.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Phase 1:       │     │  Phase 2:       │     │  Phase 3:       │
│  RESEARCH       │────▶│  BUILD          │────▶│  DEPLOY & LOG   │
│                 │     │                 │     │                 │
│  Find a local   │     │  Generate a     │     │  Push HTML to   │
│  business with  │     │  premium        │     │  GitHub Pages,  │
│  a bad website  │     │  landing page   │     │  log to Sheets  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Setup

### 1. Create the Apps Script Project

1. Open your Google Sheet (or create a new one)
2. Go to **Extensions → Apps Script**
3. Create these 5 files (click `+` → Script):
   - `Config` — paste contents of `gas/Config.js`
   - `Providers` — paste contents of `gas/Providers.js`
   - `Parser` — paste contents of `gas/Parser.js`
   - `GitHub` — paste contents of `gas/GitHub.js`
   - `Pipeline` — paste contents of `gas/Pipeline.js`

> **Tip:** You can also use [`clasp`](https://github.com/google/clasp) to push the files directly.

### 2. Set Script Properties

Go to **Project Settings → Script Properties** and add:

| Property | Required | Description |
|----------|----------|-------------|
| `LLM_PROVIDER` | ✅ | `openai`, `anthropic`, or `gemini` |
| `LLM_API_KEY` | ✅ | API key for your chosen provider |
| `GITHUB_PAT` | ✅ | GitHub Personal Access Token (needs `repo` scope) |
| `SHEET_ID` | ❌ | Override the default Google Sheet ID |
| `LLM_MODEL` | ❌ | Override the default model (e.g., `gpt-4o-mini`) |

### 3. Enable GitHub Pages

1. Go to your `website-forge` repo → **Settings → Pages**
2. Set Source to **Deploy from a branch**
3. Branch: `main`, Folder: `/ (root)`
4. Save

### 4. Run

1. Reload the Google Sheet
2. Click **🚀 WebsiteForge → Generate 1 Lead**
3. Approve the authorization prompt (first time only)
4. Watch the toast notifications as each phase completes

## Supported LLM Providers

| Provider | Default Model | Set `LLM_PROVIDER` to |
|----------|--------------|----------------------|
| OpenAI | `gpt-4o` | `openai` |
| Anthropic | `claude-sonnet-4-20250514` | `anthropic` |
| Google Gemini | `gemini-2.5-flash` | `gemini` |

Override the model with the `LLM_MODEL` Script Property.

## Google Sheets Output

Each pipeline run appends a row with these columns:

| Column | Description |
|--------|-------------|
| Date_Run | ISO date of the run |
| Area | City, State |
| Business_Name | Target business name |
| Slug | kebab-case identifier |
| Repo_URL | Link to the GitHub repo |
| Live_Pages_URL | Live demo on GitHub Pages |
| Suggested_Domain | Domain recommendation |
| Domain_Cost_Yearly | Estimated domain cost |
| Target_Email | Business contact email |
| Drafted_Email | Ready-to-send cold email |
| Status | "Review Needed" (update manually) |
| Sent_Date | Fill in after sending |

## Project Structure

```
website-forge/
├── gas/                    # Google Apps Script source files
│   ├── Config.js           # Configuration & validation
│   ├── Providers.js        # LLM provider adapters (OpenAI, Anthropic, Gemini)
│   ├── Parser.js           # Response parsing (XML tags, HTML cleanup)
│   ├── GitHub.js           # GitHub Pages deployment
│   └── Pipeline.js         # Main 3-phase orchestration
├── demos/                  # Generated demo sites (auto-deployed)
│   └── {slug}/index.html
├── LICENSE
└── README.md
```

## License

MIT