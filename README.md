# Penline

PNG to SVG converter. Upload a PNG, get back a clean, scalable SVG.

## Local development

### Backend

Requires Python 3.12+ and `libpotrace-dev` (the C library that `pypotrace` wraps).

**macOS:**
```bash
brew install potrace
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

**Ubuntu/Debian:**
```bash
sudo apt-get install libpotrace-dev
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

**Windows:** Install [potrace for Windows](http://potrace.sourceforge.net/#downloading) or use WSL. The Docker image handles this automatically.

Backend runs at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Frontend runs at `http://localhost:5173`.

## Environment variables

### Backend

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_URL` | `*` | Allowed CORS origin. Set to your Netlify URL in production. |
| `PORT` | `10000` | Port to bind (set automatically by Render). |

### Frontend

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend URL. Set to your Render service URL in Netlify deploy settings. |

## Deploy

### Backend → Render

1. Push this repo to GitHub.
2. In Render: **New → Web Service → connect repo**.
3. Select **Docker** as the runtime. Render will find `render.yaml` automatically.
4. After deploy, note the service URL (e.g. `https://penline-backend.onrender.com`).
5. Set the `FRONTEND_URL` environment variable to your Netlify URL (after step below).

> The free tier spins down after inactivity. The frontend shows "Server is warming up. Try again in a moment." during cold starts (~30s).

### Frontend → Netlify

1. In Netlify: **Add new site → Import an existing project → connect repo**.
2. Netlify reads `netlify.toml` automatically — no manual build settings needed.
3. In **Site configuration → Environment variables**, add:
   - `VITE_API_URL` = your Render service URL
4. Trigger a redeploy.

After both are live, go back to Render and set `FRONTEND_URL` to the Netlify URL to lock down CORS.

## API

```
GET  /health     → { "status": "ok" }
POST /convert    → { "svg": "<svg>…</svg>" }
```

`POST /convert` accepts `multipart/form-data` with a `file` field (PNG, max 2 MB).

Errors return `{ "error": "description" }` with an appropriate HTTP status code.
