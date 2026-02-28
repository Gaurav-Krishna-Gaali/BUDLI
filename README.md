# Budli

Budli is a full-stack data-driven application with a Python/Flask backend and a Next.js/React frontend.  
It provides an interface for running “budli” analyses, viewing historic runs, and exploring trends.  
The live app is available at: **https://budli-c9sb.vercel.app/**

---

## 🧱 Project Structure

```
backend/        # Python service (Flask or similar)
  ├─ app.py
  ├─ database.py
  ├─ models.py
  ├─ trends_helper.py
  ├─ bedrock_helper.py
  ├─ requirements.txt
  └─ …
client/         # Next.js frontend (TypeScript + Tailwind/Custom UI components)
  ├─ app/        # pages (app router)
  ├─ components/ # reusable UI primitives
  ├─ hooks/
  ├─ lib/        # domain logic
  ├─ public/
  ├─ styles/
  ├─ package.json
  └─ tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ / npm or pnpm
- Python 3.9+
- (Optional) virtual environment tool such as `venv` or `conda`

### Backend

```bash
cd backend

# create & activate virtual env
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt

# run the API
python app.py
```

The backend listens on `http://localhost:5000` by default.  
It exposes endpoints used by the front end (e.g. run submissions, history, trends).

### Client

```bash
cd client
# install deps (using npm or pnpm)
pnpm install

# run dev server
pnpm dev
```

Open your browser to `http://localhost:3000` to see the UI.  
The client expects the backend at `http://localhost:5000`; adjust `NEXT_PUBLIC_API_URL` if you change it.

---

## 🛠 Features

- **Run Management** – start new “budli” runs and view results.
- **History** – browse past runs.
- **Trends** – visualizations and summaries of historical data.
- Responsive, component-driven UI built with custom design system.
- Modular Python backend with helpers for data & external APIs.

---

## 🧪 Testing

- The repository includes a sample `test_post.js` in the backend; adapt or add unit tests as needed.
- Frontend pages can be tested with your preferred React testing library.

---

## 📁 Data

`data.csv` and `data copy.csv` in the backend folder contain sample data for development.

---

## 📦 Deployment

- **Frontend** is deployed on Vercel (current URL above).
- **Backend** can be hosted on any Python-friendly platform (Heroku, Azure App Service, etc.).  
  Ensure the frontend’s `NEXT_PUBLIC_API_URL` points to the live API.

---

## 💡 Notes

- Modify or extend helper modules (`trends_helper.py`, `bedrock_helper.py`) for custom logic.
- The client uses Next.js App Router; page files live under `client/app`.
