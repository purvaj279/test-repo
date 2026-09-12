# 🧭 WanderLore — Offbeat Sanctuaries & Lore Community Platform

WanderLore is an anti-overtourism travel platform designed to discover secluded, lesser-known sanctuaries through acoustic calm ratings, riddle-gated coordinates, community expeditions, and personalized recommendation profiles.

---

## ⚡ Quick Start (Local)

### Prerequisites
- Python 3.9+ (Python 3.11 / 3.12 / 3.13 supported)

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Initialize Database (Optional — pre-seeded database is already included)
```bash
python database.py
```

### 3. Run Application
```bash
python app.py
```
Open your browser to: **http://127.0.0.1:5000**

---

## ☁️ How to Host Online (Free & Easy Methods)

### Option 1: Render.com (Recommended Free Cloud Host)
1. Create a free account at [render.com](https://render.com).
2. Push this folder to a GitHub repository.
3. Click **"New +"** -> **"Web Service"**.
4. Connect your GitHub repository.
5. Render will automatically detect `render.yaml` or you can specify:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt && python database.py`
   - **Start Command**: `gunicorn app:app`
6. Click **"Create Web Service"**. Your platform will be live with an `https://wanderlore.onrender.com` domain!

---

### Option 2: Railway.app
1. Create an account at [railway.app](https://railway.app).
2. Click **"New Project"** -> **"Deploy from GitHub Repo"**.
3. Select your repository.
4. Railway will automatically detect the included `Procfile` and deploy your app instantly.

---

### Option 3: PythonAnywhere (Free Forever)
1. Sign up for a free beginner account at [pythonanywhere.com](https://www.pythonanywhere.com).
2. In the "Files" tab, upload `wanderlore.zip` and uncompress it using the Bash console (`unzip wanderlore.zip`).
3. Go to the "Web" tab, create a **Manual configuration (Flask)** with Python 3.11.
4. Set the path to the app directory and point WSGI to `from app import app as application`.
5. Click **Reload**. Your site is now live at `yourusername.pythonanywhere.com`!

---

### Option 4: Docker
You can run WanderLore inside a Docker container anywhere (AWS, GCP, DigitalOcean, VPS):
```bash
docker build -t wanderlore .
docker run -p 5000:5000 wanderlore
```
Then visit: `http://localhost:5000`

---

## 📂 Project Structure

```
wanderlore/
├── app.py                 # Flask REST API backend & recommendation engine
├── database.py            # SQLite schema, seed data, and personas
├── wanderlore.db          # Pre-seeded database with 12 global sanctuaries
├── requirements.txt       # Production dependencies (Flask, Gunicorn)
├── Procfile               # Cloud deployment process file
├── Dockerfile             # Container configuration
├── render.yaml            # Render.com blueprint specification
├── test_wanderlore.py     # Comprehensive automated test suite
├── templates/
│   └── index.html         # Responsive Cartographic SPA (Tailwind + Leaflet)
└── static/
    ├── css/
    │   └── style.css      # Dark cartography styling & pulsing pins
    └── js/
        └── app.js         # Leaflet map, audio synth, and personalization engine
```

---

## 🌟 Key Features
- **Acoustic Solitude Meter**: Decibel levels & solitude scores.
- **Riddle-Gated Coordinates**: Protects fragile havens from mass tourism.
- **Personalized Recommendations**: Dynamic match % calculated based on traveler persona.
- **My Journey Ledger**: Bookmarking with private field notes.
- **Generative Soundscapes**: Web Audio nature synthesizer (wind, stream, crickets).
- **The Commons**: Group expeditions and community Q&A forums.
