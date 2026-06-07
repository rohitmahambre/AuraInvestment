import React, { useState, useEffect } from 'react';
import type { Portfolio, SharePermission } from '../types';
import { collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, addDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, Trash2, Shield, Eye, ShieldAlert, FolderHeart, Calendar, Heart, ShieldCheck, Mail, RefreshCw } from 'lucide-react';

interface SharingSettingsProps {
  activePortfolio: Portfolio | null;
  onRefreshPortfolio: () => void;
  onSelectPortfolio: (portfolio: Portfolio) => void;
}

export const SharingSettings: React.FC<SharingSettingsProps> = ({
  activePortfolio,
  onRefreshPortfolio,
  onSelectPortfolio
}) => {
  const { user } = useAuth();
  const [emailToShare, setEmailToShare] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [sharedPortfolios, setSharedPortfolios] = useState<Portfolio[]>([]);
  const [loadingShared, setLoadingShared] = useState(true);
  const [sharingError, setSharingError] = useState('');
  const [sharingSuccess, setSharingSuccess] = useState('');
  const [processing, setProcessing] = useState(false);

  // Will / Dead Man's Switch States
  const [will, setWill] = useState<any | null>(null);
  const [loadingWill, setLoadingWill] = useState(true);
  const [willBeneficiaryEmail, setWillBeneficiaryEmail] = useState('');
  const [willProcessing, setWillProcessing] = useState(false);
  const [willError, setWillError] = useState('');
  const [willSuccess, setWillSuccess] = useState('');
  const [inheritedPortfolios, setInheritedPortfolios] = useState<Portfolio[]>([]);
  const [loadingInherited, setLoadingInherited] = useState(true);
  
  const WILL_MESSAGE_TEMPLATE = `Demat Account Details:
- DP ID: [Enter DP ID]
- Client ID: [Enter Client ID]
- Broker: [e.g. Zerodha, Groww, AngelOne]

Bank Accounts:
- Bank Name: [Bank Name]
- Account Number: [Account Number]
- IFSC Code: [IFSC Code]

Other Assets & Instructions:
[Enter any additional locker keys, nominee forms, or general settlement instructions here]`;

  const [willDurationDays, setWillDurationDays] = useState<number>(7);
  const [willCustomMessage, setWillCustomMessage] = useState<string>('');

  const isOwner = activePortfolio && user && activePortfolio.ownerId === user.uid;
  const isInherited = activePortfolio && inheritedPortfolios.some((p) => p.id === activePortfolio.id);

  // Load standard shared portfolios
  useEffect(() => {
    const loadSharedPortfolios = async () => {
      if (!user || !user.email) return;
      try {
        setLoadingShared(true);
        const colRef = collection(db, 'portfolios');
        const q = query(colRef, where('sharedWithEmails', 'array-contains', user.email.toLowerCase()));
        const snap = await getDocs(q);
        const list: Portfolio[] = [];
        snap.forEach((doc) => {
          list.push(doc.data() as Portfolio);
        });
        setSharedPortfolios(list);
      } catch (err) {
        console.error('Failed to load shared portfolios', err);
      } finally {
        setLoadingShared(false);
      }
    };

    loadSharedPortfolios();
  }, [user, activePortfolio]);

  // Load Will configurations and inherited portfolios
  useEffect(() => {
    loadWillForActivePortfolio();
    loadInheritedPortfolios();
  }, [user, activePortfolio]);

  // Pre-populate template if no Will exists
  useEffect(() => {
    if (!will && !willCustomMessage) {
      setWillCustomMessage(WILL_MESSAGE_TEMPLATE);
    }
  }, [will]);

  const loadWillForActivePortfolio = async () => {
    if (!activePortfolio || !user) return;
    try {
      setLoadingWill(true);
      setWillError('');
      setWillSuccess('');
      const docRef = doc(db, 'wills', activePortfolio.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const willData = docSnap.data();
        setWill(willData);
        if (willData.beneficiaryEmails && Array.isArray(willData.beneficiaryEmails)) {
          setWillBeneficiaryEmail(willData.beneficiaryEmails.join(', '));
        } else if (willData.beneficiaryEmail) {
          setWillBeneficiaryEmail(willData.beneficiaryEmail);
        } else {
          setWillBeneficiaryEmail('');
        }
        
        const duration = willData.durationDays || 7;
        setWillDurationDays(duration);
        setWillCustomMessage(willData.customMessage || '');
        
        // If owner loads a pending switch, automatically reset the countdown timer (act as check-in)
        if (willData.status === 'pending' && isOwner) {
          const now = new Date();
          const newExpiresAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000); // custom duration days
          await updateDoc(docRef, {
            lastSeenAt: now,
            expiresAt: newExpiresAt,
            updatedAt: now
          });
          setWill({
            ...willData,
            lastSeenAt: now,
            expiresAt: newExpiresAt
          });
          console.log(`Dead Man's Switch postponed. Active session reset countdown to ${duration} days.`);
        }
      } else {
        setWill(null);
        setWillBeneficiaryEmail('');
        setWillDurationDays(7);
        setWillCustomMessage(WILL_MESSAGE_TEMPLATE);
      }
    } catch (err) {
      console.error("Failed to load portfolio Will details", err);
    } finally {
      setLoadingWill(false);
    }
  };

  const loadInheritedPortfolios = async () => {
    if (!user || !user.email) return;
    try {
      setLoadingInherited(true);
      const willsRef = collection(db, 'wills');
      const now = new Date();

      // Step 1: Scan and auto-trigger any pending Wills that have expired (check both array and legacy fields)
      const qPendingArray = query(
        willsRef,
        where('beneficiaryEmails', 'array-contains', user.email.toLowerCase()),
        where('status', '==', 'pending')
      );
      const qPendingLegacy = query(
        willsRef,
        where('beneficiaryEmail', '==', user.email.toLowerCase()),
        where('status', '==', 'pending')
      );

      const [pendingSnapArray, pendingSnapLegacy] = await Promise.all([
        getDocs(qPendingArray),
        getDocs(qPendingLegacy)
      ]);

      const expiredWillsToTrigger: any[] = [];
      const seenWillIds = new Set<string>();

      const processWillSnap = (snap: any) => {
        snap.forEach((docSnap: any) => {
          if (seenWillIds.has(docSnap.id)) return;
          seenWillIds.add(docSnap.id);
          const data = docSnap.data();
          const expiresAt = data.expiresAt?.toDate();
          if (expiresAt && now > expiresAt) {
            expiredWillsToTrigger.push(docSnap);
          }
        });
      };

      processWillSnap(pendingSnapArray);
      processWillSnap(pendingSnapLegacy);

      if (expiredWillsToTrigger.length > 0) {
        const batch = writeBatch(db);
        for (const willDoc of expiredWillsToTrigger) {
          const willData = willDoc.data();
          batch.update(willDoc.ref, { 
            status: 'triggered', 
            triggeredAt: now,
            updatedAt: now 
          });
          
          const customMessageHtml = willData.customMessage ? `
            <div style="margin-top: 20px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; color: #1e293b; font-family: sans-serif;">
              <h4 style="margin-top: 0; color: #e11d48; font-size: 15px; font-weight: bold;">Message & Settlement Instructions from Owner:</h4>
              <pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px; margin: 0; line-height: 1.5; color: #334155;">${willData.customMessage}</pre>
            </div>
          ` : '';

          // Log automated mail delivery task for all beneficiaries
          const beneficiariesList = willData.beneficiaryEmails && Array.isArray(willData.beneficiaryEmails)
            ? willData.beneficiaryEmails
            : [willData.beneficiaryEmail];

          for (const bEmail of beneficiariesList) {
            if (!bEmail) continue;
            const mailRef = doc(collection(db, 'mail'));
            batch.set(mailRef, {
              to: bEmail.toLowerCase(),
              message: {
                subject: `Aura Investment: Inherited Portfolio Access Unlocked`,
                html: `<h3>Aura Investment Tracker</h3>
                       <p>You have received inheritance access to the portfolio <strong>${willData.portfolioName}</strong> via a Dead Man's Switch set up by <strong>${willData.ownerEmail}</strong>.</p>
                       <p>Log in to your account at <a href="${window.location.origin}">Aura Investment Tracker</a> to view details.</p>
                       ${customMessageHtml}`
              }
            });
          }
        }
        await batch.commit();
        console.log("Successfully triggered expired portfolio Wills.");
      }

      // Step 2: Load triggered inherited portfolios
      const qTriggeredArray = query(
        willsRef,
        where('beneficiaryEmails', 'array-contains', user.email.toLowerCase()),
        where('status', '==', 'triggered')
      );
      const qTriggeredLegacy = query(
        willsRef,
        where('beneficiaryEmail', '==', user.email.toLowerCase()),
        where('status', '==', 'triggered')
      );

      const [triggeredSnapArray, triggeredSnapLegacy] = await Promise.all([
        getDocs(qTriggeredArray),
        getDocs(qTriggeredLegacy)
      ]);

      const list: Portfolio[] = [];
      const seenTriggeredPortfolioIds = new Set<string>();

      const processTriggeredDoc = async (docSnap: any) => {
        const willData = docSnap.data();
        if (seenTriggeredPortfolioIds.has(willData.portfolioId)) return;
        seenTriggeredPortfolioIds.add(willData.portfolioId);
        const portSnap = await getDoc(doc(db, 'portfolios', willData.portfolioId));
        if (portSnap.exists()) {
          list.push(portSnap.data() as Portfolio);
        }
      };

      for (const docSnap of triggeredSnapArray.docs) {
        await processTriggeredDoc(docSnap);
      }
      for (const docSnap of triggeredSnapLegacy.docs) {
        await processTriggeredDoc(docSnap);
      }
      setInheritedPortfolios(list);
    } catch (err) {
      console.error("Failed to load inherited portfolios", err);
    } finally {
      setLoadingInherited(false);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    setSharingError('');
    setSharingSuccess('');

    if (!activePortfolio || !isOwner) return;
    if (!emailToShare.trim()) {
      setSharingError('Please enter a valid email');
      return;
    }

    const email = emailToShare.trim().toLowerCase();

    if (email === user?.email?.toLowerCase()) {
      setSharingError('You cannot share a portfolio with yourself');
      return;
    }

    const exists = activePortfolio.sharedWith.some((p) => p.email.toLowerCase() === email);
    if (exists) {
      setSharingError('Portfolio is already shared with this user');
      return;
    }

    setProcessing(true);

    try {
      const updatedSharedWith: SharePermission[] = [
        ...activePortfolio.sharedWith,
        { email, permission }
      ];

      const updatedSharedWithEmails: string[] = updatedSharedWith.map((p) => p.email);
      const updatedSharedWithEditors: string[] = updatedSharedWith
        .filter((p) => p.permission === 'write')
        .map((p) => p.email);

      const portfolioRef = doc(db, 'portfolios', activePortfolio.id);
      await updateDoc(portfolioRef, {
        sharedWith: updatedSharedWith,
        sharedWithEmails: updatedSharedWithEmails,
        sharedWithEditors: updatedSharedWithEditors,
        updatedAt: new Date()
      });

      setSharingSuccess(`Portfolio shared with ${email} successfully!`);
      setEmailToShare('');
      onRefreshPortfolio();
    } catch (err: any) {
      console.error(err);
      setSharingError(err.message || 'Failed to update sharing permissions.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveShare = async (emailToRemove: string) => {
    if (!activePortfolio || !isOwner) return;
    if (!window.confirm(`Are you sure you want to revoke access for ${emailToRemove}?`)) return;

    setProcessing(true);

    try {
      const updatedSharedWith = activePortfolio.sharedWith.filter(
        (p) => p.email.toLowerCase() !== emailToRemove.toLowerCase()
      );

      const updatedSharedWithEmails = updatedSharedWith.map((p) => p.email);
      const updatedSharedWithEditors = updatedSharedWith
        .filter((p) => p.permission === 'write')
        .map((p) => p.email);

      const portfolioRef = doc(db, 'portfolios', activePortfolio.id);
      await updateDoc(portfolioRef, {
        sharedWith: updatedSharedWith,
        sharedWithEmails: updatedSharedWithEmails,
        sharedWithEditors: updatedSharedWithEditors,
        updatedAt: new Date()
      });

      setSharingSuccess(`Access revoked for ${emailToRemove}`);
      onRefreshPortfolio();
    } catch (err: any) {
      console.error(err);
      setSharingError(err.message || 'Failed to remove sharing permissions.');
    } finally {
      setProcessing(false);
    }
  };

  // Will setup handler
  const handleInitiateWill = async (e: React.FormEvent) => {
    e.preventDefault();
    setWillError('');
    setWillSuccess('');
    if (!activePortfolio || !user || !isOwner) return;

    // Parse comma-separated list of beneficiary emails
    const beneficiaries = willBeneficiaryEmail
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(email => email !== '');

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const invalidEmail = beneficiaries.find(email => !emailRegex.test(email));
    
    if (invalidEmail) {
      setWillError(`"${invalidEmail}" is not a valid email address.`);
      return;
    }
    if (beneficiaries.length === 0) {
      setWillError("Please enter at least one beneficiary email.");
      return;
    }
    if (user?.email && beneficiaries.includes(user.email.toLowerCase())) {
      setWillError("You cannot name yourself as a beneficiary.");
      return;
    }
    if (beneficiaries.length > 5) {
      setWillError("You can designate a maximum of 5 beneficiaries.");
      return;
    }

    setWillProcessing(true);
    try {
      const now = new Date();
      const duration = willDurationDays || 7;
      const expiresAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000); // custom duration days
      
      const docRef = doc(db, 'wills', activePortfolio.id);
      const willData = {
        portfolioId: activePortfolio.id,
        portfolioName: activePortfolio.name,
        ownerId: user.uid,
        ownerEmail: user.email,
        beneficiaryEmails: beneficiaries,
        status: 'pending',
        initiatedAt: now,
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
        durationDays: duration,
        customMessage: willCustomMessage.trim()
      };

      await setDoc(docRef, willData);

      // Log mail delivery requests for all beneficiaries
      for (const bEmail of beneficiaries) {
        await addDoc(collection(db, 'mail'), {
          to: bEmail,
          message: {
            subject: `Aura Investment: Portfolio Will setup confirmation`,
            html: `<h3>Aura Investment Tracker</h3>
                   <p><strong>${user.email}</strong> has designated you as a beneficiary of their portfolio Will (Dead Man's Switch).</p>
                   <p>If they do not visit the site or log in for ${duration} days, you will automatically receive read access to their portfolio <strong>${activePortfolio.name}</strong>.</p>
                   <p>No action is required from your side at this time.</p>`
          }
        });
      }

      setWill(willData);
      setWillSuccess(`Aura Will initiated successfully for: ${beneficiaries.join(', ')}`);
    } catch (err: any) {
      console.error(err);
      setWillError(err.message || "Failed to initiate portfolio Will.");
    } finally {
      setWillProcessing(false);
    }
  };

  // Will cancellation handler
  const handleCancelWill = async () => {
    if (!activePortfolio || !user || !isOwner) return;
    if (!window.confirm("Are you sure you want to cancel the portfolio Will (Dead Man's Switch)?")) return;

    setWillProcessing(true);
    try {
      const docRef = doc(db, 'wills', activePortfolio.id);
      await deleteDoc(docRef);
      setWill(null);
      setWillBeneficiaryEmail('');
      setWillDurationDays(7);
      setWillCustomMessage(WILL_MESSAGE_TEMPLATE);
      setWillSuccess("Portfolio Will has been deactivated.");
    } catch (err: any) {
      console.error(err);
      setWillError(err.message || "Failed to cancel Will.");
    } finally {
      setWillProcessing(false);
    }
  };

  // Helper to calculate remaining time
  const getRemainingTimeText = () => {
    if (!will || !will.expiresAt) return '';
    const expiry = will.expiresAt.toDate();
    const diff = expiry.getTime() - new Date().getTime();
    if (diff <= 0) return 'Expired (Beneficiary has access)';
    
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return `${days}d ${hours}h remaining before unlock`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Access Control</h2>
        <p className="text-secondary text-sm">Manage access permissions for this portfolio and view folders shared with you.</p>
      </div>

      {isInherited && will && (
        <div className="glass-panel p-6 border-rose-500/20 bg-rose-950/5 space-y-4 animate-fade-in">
          <div className="flex items-center gap-2 text-rose-400 font-bold">
            <Heart className="w-5 h-5 text-rose-500 animate-pulse" />
            <span>Inheritance Instructions & Private Notes</span>
          </div>
          <p className="text-xs text-secondary leading-relaxed">
            The original owner (<strong>{will.ownerEmail}</strong>) left these secure settlement details for you upon portfolio transfer:
          </p>
          {will.customMessage ? (
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <pre className="text-xs text-white font-mono whitespace-pre-wrap leading-relaxed">{will.customMessage}</pre>
            </div>
          ) : (
            <div className="text-xs text-muted italic">No custom notes or instructions were left by the owner.</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Manage Sharing & Will (Left Panel) */}
        <div className="lg:col-span-2 space-y-6">
          {!activePortfolio ? (
            <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
              <Users className="w-16 h-16 text-muted mb-4" />
              <h3 className="text-xl font-bold mb-2">No Active Portfolio</h3>
              <p className="text-secondary max-w-sm">
                Please select or create a portfolio from the sidebar workspace dropdown to configure sharing access.
              </p>
            </div>
          ) : (
            <>
              {/* Collaborators list */}
              <div className="glass-panel p-6 border-white/5 space-y-6">
                <div className="flex items-center gap-2 font-semibold">
                  <Users className="w-5 h-5 text-teal-400" />
                  <span>Users with Access ({activePortfolio.name})</span>
                </div>

                {/* Invite Form */}
                {isOwner ? (
                  <form onSubmit={handleShare} className="p-4 rounded-xl border border-white/5 bg-white/[0.01] space-y-4">
                    <div className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4 text-teal-400" />
                      Invite Collaborator
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-grow">
                        <input
                          type="email"
                          required
                          placeholder="collaborator@example.com"
                          value={emailToShare}
                          onChange={(e) => setEmailToShare(e.target.value)}
                          disabled={processing}
                          className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-3"
                        />
                      </div>
                      <div className="w-full sm:w-[150px]">
                        <select
                          value={permission}
                          onChange={(e) => setPermission(e.target.value as any)}
                          disabled={processing}
                          className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-2"
                        >
                          <option value="read">Read Only</option>
                          <option value="write">Read & Write</option>
                        </select>
                      </div>
                      <button
                        type="submit"
                        className="btn btn-primary px-6 py-2.5 text-xs font-bold shrink-0"
                        disabled={processing}
                      >
                        Share
                      </button>
                    </div>

                    {sharingError && (
                      <div className="p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-xs">
                        {sharingError}
                      </div>
                    )}
                    {sharingSuccess && (
                      <div className="p-3 rounded-lg bg-green-950/20 border border-green-500/20 text-green-400 text-xs">
                        {sharingSuccess}
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="p-4 rounded-xl border border-white/5 bg-white/[0.01] text-sm text-secondary flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                      <strong>Read-Only Mode:</strong> You are currently viewing a shared portfolio. Only the owner (<strong>{activePortfolio.ownerEmail}</strong>) is authorized to modify access permissions.
                    </div>
                  </div>
                )}

                {/* List of current collaborators */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-secondary uppercase tracking-wider">Collaborators</div>
                  
                  <div className="divide-y divide-white/5">
                    {/* Owner */}
                    <div className="py-3 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-bold text-xs">
                          OW
                        </div>
                        <div>
                          <div className="font-semibold text-white">{activePortfolio.ownerEmail}</div>
                          <div className="text-xs text-secondary">Owner</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        Full Admin
                      </span>
                    </div>

                    {/* Shared users */}
                    {activePortfolio.sharedWith.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted">
                        This portfolio hasn't been shared with anyone yet.
                      </div>
                    ) : (
                      activePortfolio.sharedWith.map((sh) => (
                        <div key={sh.email} className="py-3 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-secondary font-bold text-xs uppercase">
                              {sh.email.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-semibold text-white">{sh.email}</div>
                              <div className="text-xs text-secondary capitalize">{sh.permission === 'write' ? 'Editor' : 'Viewer'}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                              sh.permission === 'write'
                                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                : 'bg-white/5 text-secondary border border-white/10'
                            }`}>
                              {sh.permission === 'write' ? <Shield className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {sh.permission === 'write' ? 'Read & Write' : 'Read Only'}
                            </span>
                            
                            {isOwner && (
                              <button
                                onClick={() => handleRemoveShare(sh.email)}
                                disabled={processing}
                                className="p-1 rounded hover:bg-white/5 text-secondary hover:text-red-400 transition-colors"
                                title="Revoke access"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Will / Dead Man's Switch Card */}
              {isOwner && (
                <div className="glass-panel p-6 border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-rose-400">
                      <Heart className="w-5 h-5 text-rose-500 animate-pulse" />
                      Aura Will (Dead Man's Switch)
                    </h3>
                    {will && will.status === 'pending' && (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                        Countdown Active
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-secondary leading-relaxed">
                    Set up secure transfer instructions. If you initiate the switch and do not log in or visit the site within your chosen timeout period, your beneficiary will automatically receive read access to this portfolio and be emailed your private instructions. Logging in automatically resets your countdown.
                  </p>

                  {loadingWill ? (
                    <div className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      Loading Will Settings...
                    </div>
                  ) : !will ? (
                    /* Setup form */
                    <form onSubmit={handleInitiateWill} className="p-4 rounded-xl border border-white/5 bg-white/[0.01] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                            <Mail className="w-4 h-4 text-rose-400" />
                            Beneficiary Emails
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="spouse@example.com, child@example.com"
                            value={willBeneficiaryEmail}
                            onChange={(e) => setWillBeneficiaryEmail(e.target.value)}
                            disabled={willProcessing}
                            className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-3 focus:outline-none focus:border-rose-500/50"
                          />
                          <p className="text-[9px] text-muted">Designate up to 5 beneficiaries separated by commas.</p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-rose-400" />
                            Inactivity Timeout Period
                          </label>
                          <select
                            value={willDurationDays}
                            onChange={(e) => setWillDurationDays(parseInt(e.target.value))}
                            disabled={willProcessing}
                            className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-3 focus:outline-none focus:border-rose-500/50"
                          >
                            <option value={7}>7 Days (1 Week)</option>
                            <option value={14}>14 Days (2 Weeks)</option>
                            <option value={30}>30 Days (1 Month)</option>
                            <option value={90}>90 Days (3 Months)</option>
                            <option value={180}>180 Days (6 Months)</option>
                            <option value={365}>365 Days (1 Year)</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                          <Heart className="w-4 h-4 text-rose-400" />
                          Private Settlement Instructions (Demat, Accounts, Notes)
                        </label>
                        <p className="text-[10px] text-muted leading-tight">
                          🔒 Stored securely. Visible and emailed to your beneficiary **only** when the switch triggers.
                        </p>
                        <textarea
                          rows={6}
                          placeholder="Fill DP IDs, account details, locker locations here..."
                          value={willCustomMessage}
                          onChange={(e) => setWillCustomMessage(e.target.value)}
                          disabled={willProcessing}
                          className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-3 font-mono focus:outline-none focus:border-rose-500/50 leading-relaxed"
                        />
                      </div>

                      <div className="flex justify-end pt-2">
                        <button
                          type="submit"
                          className="btn btn-primary bg-rose-500 hover:bg-rose-600 text-white border-rose-500 px-6 py-2.5 text-xs font-bold"
                          disabled={willProcessing}
                        >
                          {willProcessing ? 'Initiating...' : 'Initiate Switch'}
                        </button>
                      </div>

                      {willError && (
                        <div className="p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-xs">
                          {willError}
                        </div>
                      )}
                    </form>
                  ) : (
                    /* Will Status Details */
                    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.01] space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Beneficiaries</span>
                          <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-secondary" />
                            <span className="truncate max-w-[150px]" title={will.beneficiaryEmails && Array.isArray(will.beneficiaryEmails) ? will.beneficiaryEmails.join(', ') : will.beneficiaryEmail}>
                              {will.beneficiaryEmails && Array.isArray(will.beneficiaryEmails) ? will.beneficiaryEmails.join(', ') : will.beneficiaryEmail}
                            </span>
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Inactivity Period</span>
                          <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-secondary" />
                            {will.durationDays || 7} Days
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Expiry Status</span>
                          <span className="font-bold text-teal-400 text-xs flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-teal-400" />
                            {getRemainingTimeText()}
                          </span>
                        </div>
                      </div>

                      {will.customMessage && (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Your Saved Settlement Instructions</span>
                          <div className="bg-black/40 border border-white/5 p-3 rounded-lg max-h-[120px] overflow-y-auto">
                            <pre className="text-[10px] text-secondary font-mono whitespace-pre-wrap leading-relaxed">{will.customMessage}</pre>
                          </div>
                        </div>
                      )}

                      <div className="text-xs text-secondary leading-relaxed bg-white/[0.01] p-3 rounded-lg border border-white/5">
                        🛡️ **Auto-Postpone Active:** Your timer was automatically extended to {will.durationDays || 7} days when you opened this portfolio session today at **{will.lastSeenAt?.toDate()?.toLocaleTimeString()}**. 
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-white/5">
                        <button
                          onClick={handleCancelWill}
                          disabled={willProcessing}
                          className="text-xs text-red-400 hover:text-red-300 font-bold uppercase tracking-wider"
                        >
                          Cancel Will Sharing
                        </button>
                        
                        <button
                          onClick={loadWillForActivePortfolio}
                          className="text-xs text-secondary hover:text-white flex items-center gap-1 font-semibold"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Check-in Again
                        </button>
                      </div>

                      {willError && (
                        <div className="p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-xs">
                          {willError}
                        </div>
                      )}
                      {willSuccess && (
                        <div className="p-3 rounded-lg bg-green-950/20 border border-green-500/20 text-green-400 text-xs">
                          {willSuccess}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Portfolios Shared & Inherited (Right Panel) */}
        <div className="space-y-6">
          {/* Standard shared portfolios */}
          <div className="glass-panel p-6 border-white/5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <FolderHeart className="w-5 h-5 text-indigo-400" />
              Shared Portfolios
            </h3>
            
            <p className="text-xs text-secondary leading-relaxed">
              These portfolios belong to other users who have invited you as a viewer or editor.
            </p>

            <div className="divide-y divide-white/5">
              {loadingShared ? (
                <div className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                  Checking shares...
                </div>
              ) : sharedPortfolios.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted">
                  No portfolios shared with you yet.
                </div>
              ) : (
                sharedPortfolios.map((port) => (
                  <button
                    key={port.id}
                    onClick={() => onSelectPortfolio(port)}
                    className="w-full py-3 flex flex-col gap-1 items-start text-left hover:bg-white/5 px-2 rounded-lg transition-colors duration-150"
                  >
                    <div className="font-semibold text-white text-sm">{port.name}</div>
                    <div className="text-xs text-secondary">Owner: {port.ownerEmail}</div>
                    <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 mt-1">
                      Collaborator
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Inherited Portfolios (via Dead Man's Switch) */}
          <div className="glass-panel p-6 border-white/5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2 text-rose-400">
              <Heart className="w-5 h-5 text-rose-500 animate-pulse" />
              Inherited Portfolios
            </h3>
            
            <p className="text-xs text-secondary leading-relaxed">
              These portfolios have been transferred to you securely via estate Wills because the owner went inactive.
            </p>

            <div className="divide-y divide-white/5">
              {loadingInherited ? (
                <div className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                  Checking Wills...
                </div>
              ) : inheritedPortfolios.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted">
                  No inherited portfolios available yet.
                </div>
              ) : (
                inheritedPortfolios.map((port) => (
                  <button
                    key={port.id}
                    onClick={() => onSelectPortfolio(port)}
                    className="w-full py-3 flex flex-col gap-1 items-start text-left hover:bg-white/5 px-2 rounded-lg transition-colors duration-150"
                  >
                    <div className="font-semibold text-white text-sm">{port.name}</div>
                    <div className="text-xs text-secondary">Deceased: {port.ownerEmail}</div>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 mt-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Inherited Owner
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
