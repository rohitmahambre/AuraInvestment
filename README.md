# Aura Investment Tracker 🚀

Aura Investment Tracker is a premium web application designed to track portfolios, analyze mutual fund overlaps, and receive AI-driven rebalancing recommendations.

---

## Key Features 🌟

### 1. Aura AI Advisor 🔮
* **Persistent Bottom-Right Float:** Available from anywhere in the app without scrolling.
* **Intelligent Insights:** Connects to Gemini API to analyze your assets, suggest optimizations, and answer investment questions in real-time.

### 2. Mutual Fund Overlap Analyser 📊
* **Portfolio Matrix & Advisor:** 
  * Computes a pairwise correlation/overlap matrix for all mutual funds currently in the portfolio.
  * Robust batch fetching (throttled in groups of 6) to handle large portfolios without triggering API rate limits.
  * Graceful handling of funds without stock holding data (like Gold or Debt ETFs).
  * Direct "Ask Aura" prompt to query Gemini for customized rebalancing recommendations.
* **Compare 2 Funds:** 
  * Side-by-side comparison of individual constituent holdings and sector weightings.
* **Test New Fund (Pre-Buy Analysis):** 
  * Real-time debounced autocomplete search using the public `api.mfapi.in` API.
  * Valuation-weighted aggregate portfolio calculator to check new fund overlaps against your current combined holdings:
    $$W_{\text{portfolio}}(s) = \sum_i W_i \times \text{Weight}_i(s)$$
  * Displays common stock holdings, unique assets, and sector exposure gaps.

---

## Tech Stack 🛠️

* **Frontend:** React, TypeScript, Vite, TailwindCSS, Lucide Icons
* **Database & Auth:** Firebase Firestore & Firebase Auth
* **AI Engine:** Google Gemini API (Firebase AI Logic / Direct Integration)
* **Hosting:** Firebase Hosting (Classic)

---

## Setup & Installation ⚙️

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/rohitmahambre/AuraInvestment.git
   cd AuraInvestment
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add your keys (refer to `.env.example`):
   ```env
   VITE_FIREBASE_API_KEY=your_key
   VITE_FIREBASE_AUTH_DOMAIN=your_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Run Locally:**
   ```bash
   npm run dev
   ```

5. **Build for Production:**
   ```bash
   npm run build
   ```

---

## Deployment ☁️

The app is configured for deployment via Firebase Hosting:
```bash
# Ensure you are logged into firebase
npx firebase login

# Deploy production build
npx firebase deploy
```

Live site: [https://melavo-514b7.web.app](https://melavo-514b7.web.app)
