# Aura Investment Tracker 🚀

Aura Investment Tracker is a premium serverless web application built in **React**, **TypeScript**, and **Vite** designed to track personal investment portfolios (Mutual Funds, Stocks, Debt Instruments, and Savings), analyze mutual fund overlap matrices, construct Will switches, and provide real-time AI-driven rebalancing recommendations.

---

## Key Features 🌟

### 1. Aura AI Advisor 🔮
* **Persistent Bottom-Right Float:** Instantly accessible from anywhere in the app.
* **Intelligent Insights:** Connects to the Gemini API to analyze your assets, suggest portfolio rebalancing, and answer complex financial questions.
* **Dynamic Key Resolver:** Securely loads API keys from your browser's environment variables, browser local storage, or a secured Firestore configuration document based on user identity.

### 2. Mutual Fund Overlap Analyser 📊
* **Portfolio Matrix & Advisor:** 
  * Computes a pairwise correlation and overlap matrix for all mutual funds currently in the portfolio.
  * Throttled batch fetching (groups of 6) to query fund constituent lists without hitting public API rate limits.
  * Gracefully handles non-equity or non-holding funds (such as Gold or Debt ETFs).
  * Direct "Ask Aura" query for Gemini-powered overlap rebalancing advice.
* **Side-by-Side Comparison:** 
  * Compares sector weightings and direct constituent holdings between any two selected funds.
* **Test New Fund (Pre-Buy Analysis):** 
  * Ingests potential mutual fund purchases via debounced autocomplete search (utilizing the public `api.mfapi.in` API).
  * Computes the hypothetical overlap against your current aggregated portfolio:
    $$W_{\text{portfolio}}(s) = \sum_i W_i \times \text{Weight}_i(s)$$
  * Displays common holdings, unique exposure additions, and sector diversification changes.

### 3. Aura Will (Dead Man's Switch) 📜
* **Secure Legacy Transitions:** Automatically trigger portfolio sharing or transfer of authority to designated beneficiaries if the owner is inactive for a configurable duration.
* **Private Settlement Notes:** Safely attach sensitive transition comments and distribution percentages only visible to beneficiaries upon switch execution.

---

## System Architecture & Tech Stack 🛠️

Aura is a **serverless client-side application** designed to run entirely in the browser. It communicates directly with Firebase services and third-party APIs.

* **Frontend:** React 18 (TypeScript), Vite 8, Vanilla CSS (custom glassmorphic design system), Recharts (for compounding projection charting), Lucide React (icons).
* **Database & Real-Time Sync:** Cloud Firestore (structured, multi-tenant document store with nested subcollections).
* **Authentication:** Firebase Authentication (supporting Google and Email/Password sign-ins).
* **AI Integration:** Google Gemini API (invoked directly from the client browser using `gemini-2.5-flash`).
* **Hosting:** Firebase Hosting (utilizing rewrite rules for Single Page Application routing).

---

## Local Development Setup ⚙️

### 1. Prerequisites
* **Node.js** (v18.x or later recommended)
* **npm** (v9.x or later)
* A **Firebase Project** (created via the [Firebase Console](https://console.firebase.google.com/))

### 2. Installation & Run
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
   Create a `.env` file in the root directory and copy the variables from `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Fill in your Firebase web app credentials:
   ```env
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   
   # Optional: If you want to hardcode your Gemini API Key for local dev:
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```
4. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Security & Gemini API Key Management 🔒

In client-side serverless projects, hardcoding API keys in build-time configuration can expose secrets to third parties. Aura implements a **multi-tier key resolver** to secure your Google Gemini developer key:

1. **Environment Variable:** The app checks `import.meta.env.VITE_GEMINI_API_KEY`.
2. **Firestore Secret Store:**
   * If no local environment key is set, the app checks Firestore for a secure key document based on the authenticated user's email.
   * If logged in as the administrator (default: `admin@example.com`), the app attempts to read the key from the Firestore collection `/secrets/gemini`.
   * If logged in as the demo user (`demo@melavo.com`), the app reads a low-rate-limit key from `/secrets/demo_gemini`.
3. **Local Storage:**
   * If none of the above are available, the user is prompted to input their own Gemini API key inside the settings panel. This key is saved locally in the browser's `localStorage` (`gemini_api_key`) and is never sent to any external server other than Google's Gemini API endpoints.

> [!IMPORTANT]
> **Firestore Security Rules Protection:**
> The `/secrets` collection is locked down at the database level using `firestore.rules`. Even if someone compromises the web page, Firebase rejects read/write requests from any user who is not authenticated as the explicit administrator.

### 4. Customizing the Administrator Email 👤
By default, the application hardcodes `admin@example.com` as the administrator, which grants exclusive authority to read and write database-stored Gemini API keys. To customize this for your own setup:
1. **Search and Replace:** Search the codebase for `admin@example.com` and replace it with your administrator email.
2. **Update Security Rules:** Open [rules](file:///Users/rmahambre/InvestmentTracker/firestore.rules), locate matches under `/secrets/gemini` and `/secrets/demo_gemini` (lines 191-198), and change the email address values.
3. **Redeploy Rules:** Run `firebase deploy --only firestore:rules` to publish the new permissions.


---

## Production Deployment ☁️

Follow these steps to deploy Aura to a production environment.

### 1. Set Up Firebase Project Services
In the [Firebase Console](https://console.firebase.google.com/):
1. **Enable Authentication:** Navigate to Build -> Authentication and activate the **Email/Password** and **Google** sign-in providers.
2. **Create Firestore Database:** Navigate to Build -> Firestore Database and create a database instance in production mode.

### 2. Deploy Security Rules & Indexes
1. **Install Firebase CLI globally:**
   ```bash
   npm install -g firebase-tools
   ```
2. **Authenticate with Firebase:**
   ```bash
   firebase login
   ```
3. **Link Your Firebase Project:**
   ```bash
   firebase use --add
   ```
   Select your production Firebase project from the list.
4. **Deploy Database Rules & Schema Indexes:**
   ```bash
   firebase deploy --only firestore
   ```
   *This deploys the robust schema validations and admin-only rules in `firestore.rules` and database indexes in `firestore.indexes.json`.*

### 3. Save Production Secrets
To configure the AI advisor for users in production without redeploying the app:
1. Log in to the deployed application as your configured administrator email.
2. Open the AI advisor floating Sparks bubble (bottom right/left).
3. Under settings, input your Google Gemini API Key and select **"Save to Cloud Database"**.
4. This action writes the key to `/secrets/gemini` in Firestore, making it instantly available for your administrator session.

### 4. Build and Deploy Web Assets
1. **Compile & Bundle:**
   ```bash
   npm run build
   ```
   *This validates TypeScript and builds optimized production bundles inside the `dist/` directory.*
2. **Deploy to Firebase Hosting:**
   ```bash
   firebase deploy --only hosting
   ```
3. **Verify Deployment:**
   Your application will be live at: `https://<your-project-id>.web.app` (or `firebaseapp.com`).
