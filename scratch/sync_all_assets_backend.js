import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

initializeApp({
  projectId: "melavo-514b7"
});

const db = getFirestore();

// Parse CLI arguments
const args = process.argv.slice(2);
let targetPortfolioId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--portfolio' && i + 1 < args.length) {
    targetPortfolioId = args[i + 1].trim();
  }
}

async function syncPortfolio(pId, pName) {
  console.log(`\n==================================================`);
  console.log(`Syncing portfolio: ${pName} (ID: ${pId})...`);
  console.log(`==================================================`);

  const invRef = db.collection(`portfolios/${pId}/investments`);
  const snapshot = await invRef.get();
  const docs = snapshot.docs;
  console.log(`Found ${docs.length} holdings in Firestore.`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const doc of docs) {
    const inv = doc.data();
    const units = inv.units;

    if (inv.type === 'stock' && inv.ticker && units) {
      try {
        const tickerClean = inv.ticker.trim();
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tickerClean}`);
        if (!res.ok) throw new Error(`Yahoo Finance request failed with status ${res.status}`);
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;

        if (typeof price === 'number' && price > 0) {
          const newCurrentVal = units * price;
          await doc.ref.update({
            currentValue: parseFloat(newCurrentVal.toFixed(2)),
            updatedAt: new Date()
          });
          successCount++;
          console.log(`[SUCCESS] Stock ${inv.name} (${tickerClean}): Price ${price} -> Value ${newCurrentVal.toFixed(2)}`);
        } else {
          failCount++;
          console.log(`[FAIL] Stock ${inv.name}: Invalid price returned: ${price}`);
        }
      } catch (err) {
        failCount++;
        console.error(`[ERROR] Failed to sync stock ${inv.name}:`, err.message);
      }
    } else if (inv.type === 'mutual_fund' && inv.schemeCode && units) {
      try {
        const res = await fetch(`https://api.mfapi.in/mf/${inv.schemeCode}`);
        if (!res.ok) throw new Error(`AMFI API request failed with status ${res.status}`);
        const data = await res.json();

        if (data && data.data && data.data.length > 0) {
          const nav = parseFloat(data.data[0].nav);
          if (!isNaN(nav) && nav > 0) {
            const newCurrentVal = units * nav;
            await doc.ref.update({
              currentValue: parseFloat(newCurrentVal.toFixed(2)),
              updatedAt: new Date()
            });
            successCount++;
            console.log(`[SUCCESS] Mutual Fund ${inv.name}: NAV ${nav} -> Value ${newCurrentVal.toFixed(2)}`);
          } else {
            failCount++;
            console.log(`[FAIL] Mutual Fund ${inv.name}: Invalid NAV returned: ${nav}`);
          }
        } else {
          failCount++;
          console.log(`[FAIL] Mutual Fund ${inv.name}: Empty data returned from API`);
        }
      } catch (err) {
        failCount++;
        console.error(`[ERROR] Failed to sync Mutual Fund ${inv.name}:`, err.message);
      }
    } else {
      skipCount++;
    }

    // Throttle slightly to respect API rate limits (100ms)
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`Finished portfolio ${pName}! Success: ${successCount}, Failed: ${failCount}, Skipped: ${skipCount}`);
}

async function run() {
  try {
    if (targetPortfolioId) {
      // Fetch details of specific portfolio
      const pDoc = await db.collection('portfolios').doc(targetPortfolioId).get();
      if (!pDoc.exists) {
        console.error(`Portfolio with ID ${targetPortfolioId} not found in Firestore.`);
        process.exit(1);
      }
      await syncPortfolio(pDoc.id, pDoc.data().name || 'Unnamed Portfolio');
    } else {
      // Fetch all portfolios
      console.log("Querying all portfolios from Firestore...");
      const portfoliosSnap = await db.collection('portfolios').get();
      console.log(`Found ${portfoliosSnap.size} portfolios to sync.`);
      
      for (const pDoc of portfoliosSnap.docs) {
        await syncPortfolio(pDoc.id, pDoc.data().name || 'Unnamed Portfolio');
        // Throttle slightly between portfolios
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.log("\n==================================================");
    console.log("SUCCESS: All sync jobs completed successfully.");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("Global sync failed:", err);
    process.exit(1);
  }
}

run();
