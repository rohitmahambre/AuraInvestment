import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fetch from 'node-fetch'; // Vite project has node-fetch available or we can use native fetch since Node 18+ has it. Node.js on Mac (v18+) has native fetch, but node-fetch is safer in all environment configurations. Let's try native fetch first.

// Fallback rates if API fails
const FALLBACK_RATES = {
  INR: 90.0,
  EUR: 1.0,
  USD: 1.08
};

// Initialize Firebase Admin
let appOptions = {
  projectId: "melavo-514b7"
};

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (serviceAccountJson) {
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    appOptions.credential = cert(serviceAccount);
    console.log("Using Firebase credentials from environment secret.");
  } catch (err) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:", err);
  }
}

initializeApp(appOptions);
const db = getFirestore();

// Helper to convert currency (matching frontend logic)
function convertCurrency(amount, from, to, rates) {
  if (from === to) return amount;
  
  // Convert to base currency (EUR) first
  let amountInEur = amount;
  if (from === 'INR') {
    amountInEur = amount / rates.INR;
  } else if (from === 'USD') {
    amountInEur = amount / rates.USD;
  }

  // Convert from base currency (EUR) to target currency
  if (to === 'INR') {
    return amountInEur * rates.INR;
  } else if (to === 'USD') {
    return amountInEur * rates.USD;
  }

  return amountInEur;
}

// Fetch exchange rates
async function fetchRates() {
  try {
    console.log("Fetching live exchange rates...");
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=INR,USD');
    if (res.ok) {
      const data = await res.json();
      return {
        INR: data.rates.INR,
        EUR: 1.0,
        USD: data.rates.USD
      };
    }
    
    const altRes = await fetch('https://api.frankfurter.app/latest?base=EUR&symbols=INR,USD');
    if (altRes.ok) {
      const data = await altRes.json();
      return {
        INR: data.rates.INR,
        EUR: 1.0,
        USD: data.rates.USD
      };
    }
    
    throw new Error("Frankfurter API returned non-200");
  } catch (err) {
    console.warn("Failed to fetch live exchange rates, using fallback rates:", err.message);
    return FALLBACK_RATES;
  }
}

// Parse args for manual month override
function getTargetMonth() {
  const args = process.argv.slice(2);
  const monthIdx = args.indexOf('--month');
  if (monthIdx !== -1 && args[monthIdx + 1]) {
    const customMonth = args[monthIdx + 1];
    if (/^\d{4}-\d{2}$/.test(customMonth)) {
      console.log(`Using custom target month from arguments: ${customMonth}`);
      return customMonth;
    }
    console.warn(`Invalid month format "${customMonth}". Expected YYYY-MM.`);
  }

  const today = new Date();
  let targetYear = today.getFullYear();
  let targetMonth = today.getMonth() + 1; // 1-indexed (1 = Jan, 12 = Dec)

  // If today is in the first 5 days of the month, target the previous month
  if (today.getDate() <= 5) {
    targetMonth -= 1;
    if (targetMonth === 0) {
      targetMonth = 12;
      targetYear -= 1;
    }
  }

  const calculatedMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  console.log(`Calculated target month: ${calculatedMonth} (Today is day ${today.getDate()})`);
  return calculatedMonth;
}

async function run() {
  try {
    const rates = await fetchRates();
    console.log("Active Exchange Rates:", rates);

    const targetMonth = getTargetMonth();

    // Fetch all portfolios
    console.log("Fetching all portfolios...");
    const portfoliosSnapshot = await db.collection('portfolios').get();
    
    if (portfoliosSnapshot.empty) {
      console.log("No portfolios found in database.");
      return;
    }

    console.log(`Found ${portfoliosSnapshot.size} portfolios. Starting snapshot process...`);

    for (const portfolioDoc of portfoliosSnapshot.docs) {
      const portfolioId = portfolioDoc.id;
      const portfolioName = portfolioDoc.data().name || "Unnamed Portfolio";
      console.log(`\n--------------------------------------------`);
      console.log(`Processing Portfolio: "${portfolioName}" (${portfolioId})`);

      // Fetch all investments for this portfolio
      const investmentsSnapshot = await db.collection(`portfolios/${portfolioId}/investments`).get();
      
      let computedNetWorthInR = 0;
      let activeInvestmentsCount = 0;

      investmentsSnapshot.forEach(doc => {
        const inv = doc.data();
        // Exclude insurance policies other than life insurance (term, health, motor)
        const isExcluded = inv.type === 'insurance' && inv.policyType !== 'life';
        
        if (!isExcluded) {
          const valueInInr = convertCurrency(inv.currentValue || 0, inv.currency || 'INR', 'INR', rates);
          computedNetWorthInR += valueInInr;
          activeInvestmentsCount++;
        }
      });

      const roundedNetWorth = Math.round(computedNetWorthInR);
      console.log(`Calculated Consolidated Net Worth (INR): ${roundedNetWorth} (${activeInvestmentsCount} active assets)`);

      // Reference to snapshots collection
      const snapshotsColl = db.collection(`portfolios/${portfolioId}/snapshots`);
      
      // Query if snapshot for this month already exists
      const existingSnapQuery = await snapshotsColl.where('month', '==', targetMonth).get();
      
      let docRef;
      let existingData = null;

      if (!existingSnapQuery.empty) {
        const existingDoc = existingSnapQuery.docs[0];
        docRef = existingDoc.ref;
        existingData = existingDoc.data();
        console.log(`Existing snapshot found for month ${targetMonth} (ID: ${existingDoc.id}). Overwriting...`);
      } else {
        docRef = snapshotsColl.doc();
        console.log(`No existing snapshot for month ${targetMonth}. Creating a new one (ID: ${docRef.id})...`);
      }

      const snapshotPayload = {
        id: docRef.id,
        portfolioId: portfolioId,
        month: targetMonth,
        value: roundedNetWorth,
        currency: "INR",
        createdAt: existingData ? existingData.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      await docRef.set(snapshotPayload, { merge: true });
      console.log(`Successfully saved snapshot for "${portfolioName}". Value: ₹${roundedNetWorth.toLocaleString('en-IN')}`);
    }

    console.log("\n============================================");
    console.log("SUCCESS: Monthly snapshots capture complete!");
    process.exit(0);

  } catch (error) {
    console.error("Snapshot capture failed with error:", error);
    process.exit(1);
  }
}

run();
