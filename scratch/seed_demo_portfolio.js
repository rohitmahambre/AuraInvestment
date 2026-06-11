import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

initializeApp({
  projectId: "melavo-514b7"
});

const db = getFirestore();
const auth = getAuth();

// Demo Portfolio Config
const demoId = "demo-portfolio-id";
const demoOwnerId = "bXjpmZIm4AVHpd8JDpTcjy4PWrA2";
const demoOwnerEmail = "demo@melavo.com";

// Historical Snaps
const historicalSnaps = [
  { month: "2025-05", value: 6588514.70 },
  { month: "2025-06", value: 6902745.30 },
  { month: "2025-07", value: 9322659.25 },
  { month: "2025-08", value: 9177428.41 },
  { month: "2025-09", value: 9415551.28 },
  { month: "2025-10", value: 9930040.94 },
  { month: "2025-11", value: 10076900.18 },
  { month: "2025-12", value: 10153465.27 },
  { month: "2026-01", value: 10110007.13 },
  { month: "2026-02", value: 10179923.35 },
  { month: "2026-03", value: 9264686.63 },
  { month: "2026-04", value: 10293999.05 },
  { month: "2026-05", value: 10478090.70 },
  { month: "2026-06", value: 10774480.00 } // June snapshot value
];

// Sample Investments
const sampleInvestments = [
  {
    name: "Apple Inc. (AAPL)",
    type: "stock",
    region: "Other",
    currency: "USD",
    amountInvested: 18000,
    currentValue: 25000,
    ticker: "AAPL",
    isSipActive: true,
    sipAmount: 250,
    sipFrequency: "monthly",
    sipDay: 10,
    institution: "Interactive Brokers"
  },
  {
    name: "HDFC Flexi Cap Fund Direct Growth",
    type: "mutual_fund",
    region: "India",
    currency: "INR",
    amountInvested: 350000,
    currentValue: 450000,
    schemeCode: 101818,
    isSipActive: true,
    sipAmount: 10000,
    sipFrequency: "monthly",
    sipDay: 5,
    institution: "HDFC Mutual Fund"
  },
  {
    name: "Parag Parikh Flexi Cap Fund",
    type: "mutual_fund",
    region: "India",
    currency: "INR",
    amountInvested: 500000,
    currentValue: 680000,
    schemeCode: 122639,
    institution: "PPFAS Mutual Fund"
  },
  {
    name: "SBI Fixed Deposit",
    type: "fd",
    region: "India",
    currency: "INR",
    amountInvested: 500000,
    currentValue: 525000,
    interestRate: 7.1,
    interestType: "compound",
    compoundingFrequency: "quarterly",
    startDate: "2025-01-15",
    maturityDate: "2027-01-15",
    institution: "State Bank of India"
  },
  {
    name: "Revolut Savings",
    type: "savings",
    region: "Europe",
    currency: "EUR",
    amountInvested: 12500,
    currentValue: 12500,
    institution: "Revolut Bank"
  }
];

// Sample Trips (Tax Tracker logs)
const sampleTrips = [
  { startDate: '2024-05-10', endDate: '2024-06-05', purpose: 'Family Visit', notes: 'Summer Trip to India' },
  { startDate: '2025-12-15', endDate: '2026-01-10', purpose: 'Winter Holidays', notes: 'Festivals trip' },
  { startDate: '2026-03-20', endDate: '2026-04-15', purpose: 'Business Conference', notes: 'Tech meetups' }
];

// Sample Goals
const sampleGoals = [
  {
    name: "Retirement Nest Egg",
    targetAmount: 500000,
    targetCurrency: "EUR",
    targetYears: 25,
    monthlyContribution: 800,
    riskProfile: "balanced"
  },
  {
    name: "Vacation Cabin Fund",
    targetAmount: 120000,
    targetCurrency: "EUR",
    targetYears: 8,
    monthlyContribution: 1000,
    riskProfile: "conservative"
  }
];

async function runSeeding() {
  console.log("=================================================");
  console.log(`Starting Demo Portfolio Seeding...`);
  console.log("=================================================");

  try {
    // 0. Ensure Demo Auth User exists
    console.log("Checking Demo Auth User...");
    let userExists = false;
    try {
      await auth.getUser(demoOwnerId);
      userExists = true;
      console.log(`Demo Auth User already exists (UID: ${demoOwnerId}).`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log(`Demo Auth User not found. Creating user...`);
      } else {
        throw err;
      }
    }

    if (!userExists) {
      await auth.createUser({
        uid: demoOwnerId,
        email: demoOwnerEmail,
        password: "DemoPassword123!",
        displayName: "Demo User",
        emailVerified: true
      });
      console.log("Successfully created Demo Auth User.");
    } else {
      // Ensure the password is set to default
      await auth.updateUser(demoOwnerId, {
        password: "DemoPassword123!"
      });
      console.log("Updated Demo Auth User password to default: DemoPassword123!");
    }

    // 1. Ensure Demo Portfolio Document exists
    console.log("\nChecking Demo Portfolio document...");
    const portfolioDocRef = db.doc(`portfolios/${demoId}`);
    await portfolioDocRef.set({
      id: demoId,
      name: "Demo Growth Portfolio",
      ownerId: demoOwnerId,
      ownerEmail: demoOwnerEmail,
      sharedWith: [],
      sharedWithEmails: [],
      sharedWithEditors: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    console.log("Demo portfolio document created or updated.");

    // 2. Seed Investments
    console.log("\nSeeding Investments...");
    const investmentsColl = db.collection(`portfolios/${demoId}/investments`);
    const existingInvestments = await investmentsColl.get();
    if (existingInvestments.size > 0) {
      console.log(`Clearing ${existingInvestments.size} old investments...`);
      const deleteBatch = db.batch();
      existingInvestments.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }

    const investmentsBatch = db.batch();
    for (const inv of sampleInvestments) {
      const docRef = investmentsColl.doc();
      investmentsBatch.set(docRef, {
        id: docRef.id,
        portfolioId: demoId,
        ...inv,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await investmentsBatch.commit();
    console.log(`Successfully seeded ${sampleInvestments.length} investments.`);

    // 3. Seed Monthly Snapshots
    console.log("\nSeeding Snapshots...");
    const snapshotsColl = db.collection(`portfolios/${demoId}/snapshots`);
    const existingSnapshots = await snapshotsColl.get();
    if (existingSnapshots.size > 0) {
      console.log(`Clearing ${existingSnapshots.size} old snapshots...`);
      const deleteBatch = db.batch();
      existingSnapshots.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }

    const snapshotsBatch = db.batch();
    for (const item of historicalSnaps) {
      const docRef = snapshotsColl.doc();
      snapshotsBatch.set(docRef, {
        id: docRef.id,
        portfolioId: demoId,
        month: item.month,
        value: item.value,
        currency: "INR", // Logged in INR base for historical data comparison
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await snapshotsBatch.commit();
    console.log(`Successfully seeded ${historicalSnaps.length} net worth snapshots.`);

    // 4. Seed Trips (Tax Tracker presence logs)
    console.log("\nSeeding Travel Trips...");
    const tripsColl = db.collection(`portfolios/${demoId}/trips`);
    const existingTrips = await tripsColl.get();
    if (existingTrips.size > 0) {
      console.log(`Clearing ${existingTrips.size} old trips...`);
      const deleteBatch = db.batch();
      existingTrips.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }

    const tripsBatch = db.batch();
    for (const t of sampleTrips) {
      const docRef = tripsColl.doc();
      tripsBatch.set(docRef, {
        id: docRef.id,
        portfolioId: demoId,
        destinationRegion: 'India',
        purpose: t.purpose,
        startDate: t.startDate,
        endDate: t.endDate,
        notes: t.notes,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await tripsBatch.commit();
    console.log(`Successfully seeded ${sampleTrips.length} travel logs.`);

    // 5. Seed Goals
    console.log("\nSeeding Goals...");
    const existingGoalsQuery = await db.collection('goals')
      .where('portfolioId', '==', demoId)
      .get();
    if (existingGoalsQuery.size > 0) {
      console.log(`Clearing ${existingGoalsQuery.size} old goals...`);
      const deleteBatch = db.batch();
      existingGoalsQuery.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }

    const goalsBatch = db.batch();
    for (const g of sampleGoals) {
      const docRef = db.collection('goals').doc();
      goalsBatch.set(docRef, {
        id: docRef.id,
        portfolioId: demoId,
        ownerId: demoOwnerId,
        ...g,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await goalsBatch.commit();
    console.log(`Successfully seeded ${sampleGoals.length} planning goals.`);

    console.log("\n=================================================");
    console.log("SUCCESS: Seeding completed! Demo portfolio is full.");
    console.log("=================================================");
    process.exit(0);

  } catch (error) {
    console.error("Seeding failed with error:", error);
    process.exit(1);
  }
}

runSeeding();
