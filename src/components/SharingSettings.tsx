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

  const isOwner = activePortfolio && user && activePortfolio.ownerId === user.uid;

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
        setWillBeneficiaryEmail(willData.beneficiaryEmail || '');
        
        // If owner loads a pending switch, automatically reset the 7-day timer (act as check-in)
        if (willData.status === 'pending' && isOwner) {
          const now = new Date();
          const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
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
          console.log("Dead Man's Switch postponed. Active session reset countdown to 7 days.");
        }
      } else {
        setWill(null);
        setWillBeneficiaryEmail('');
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

      // Step 1: Scan and auto-trigger any pending Wills that have expired
      const qPending = query(
        willsRef,
        where('beneficiaryEmail', '==', user.email.toLowerCase()),
        where('status', '==', 'pending')
      );
      const pendingSnap = await getDocs(qPending);
      const expiredWillsToTrigger: any[] = [];
      
      pendingSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const expiresAt = data.expiresAt?.toDate();
        if (expiresAt && now > expiresAt) {
          expiredWillsToTrigger.push(docSnap);
        }
      });

      if (expiredWillsToTrigger.length > 0) {
        const batch = writeBatch(db);
        for (const willDoc of expiredWillsToTrigger) {
          batch.update(willDoc.ref, { 
            status: 'triggered', 
            triggeredAt: now,
            updatedAt: now 
          });
          
          // Log automated mail delivery task
          const mailRef = doc(collection(db, 'mail'));
          batch.set(mailRef, {
            to: user.email.toLowerCase(),
            message: {
              subject: `Aura Investment: Inherited Portfolio Access Unlocked`,
              html: `<h3>Aura Investment Tracker</h3>
                     <p>You have received inheritance access to the portfolio <strong>${willDoc.data().portfolioName}</strong> via a Dead Man's Switch set up by <strong>${willDoc.data().ownerEmail}</strong>.</p>
                     <p>Log in to your account at <a href="https://melavo-514b7.web.app">Aura Investment Tracker</a> to view details.</p>`
            }
          });
        }
        await batch.commit();
        console.log("Successfully triggered expired portfolio Wills.");
      }

      // Step 2: Load triggered inherited portfolios
      const qTriggered = query(
        willsRef,
        where('beneficiaryEmail', '==', user.email.toLowerCase()),
        where('status', '==', 'triggered')
      );
      const triggeredSnap = await getDocs(qTriggered);
      const list: Portfolio[] = [];
      
      for (const docSnap of triggeredSnap.docs) {
        const willData = docSnap.data();
        const portSnap = await getDoc(doc(db, 'portfolios', willData.portfolioId));
        if (portSnap.exists()) {
          list.push(portSnap.data() as Portfolio);
        }
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

    const beneficiary = willBeneficiaryEmail.trim().toLowerCase();
    if (!beneficiary) {
      setWillError("Please enter a valid email for the beneficiary.");
      return;
    }
    if (beneficiary === user.email?.toLowerCase()) {
      setWillError("You cannot name yourself as the beneficiary.");
      return;
    }

    setWillProcessing(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      const docRef = doc(db, 'wills', activePortfolio.id);
      const willData = {
        portfolioId: activePortfolio.id,
        portfolioName: activePortfolio.name,
        ownerId: user.uid,
        ownerEmail: user.email,
        beneficiaryEmail: beneficiary,
        status: 'pending',
        initiatedAt: now,
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      };

      await setDoc(docRef, willData);

      // Log mail delivery request in mail collection
      await addDoc(collection(db, 'mail'), {
        to: beneficiary,
        message: {
          subject: `Aura Investment: Portfolio Will setup confirmation`,
          html: `<h3>Aura Investment Tracker</h3>
                 <p><strong>${user.email}</strong> has designated you as the beneficiary of their portfolio Will (Dead Man's Switch).</p>
                 <p>If they do not visit the site or log in for 7 days, you will automatically receive read access to their portfolio <strong>${activePortfolio.name}</strong>.</p>
                 <p>No action is required from your side at this time.</p>`
        }
      });

      setWill(willData);
      setWillSuccess(`Aura Will initiated successfully! Beneficiary: ${beneficiary}`);
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
                    Set up a secure transfer instructions. If you initiate the switch and do not log in or visit the site within **7 days**, your beneficiary will automatically receive read access to this portfolio. Logging in automatically resets your life status timer.
                  </p>

                  {loadingWill ? (
                    <div className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      Loading Will Settings...
                    </div>
                  ) : !will ? (
                    /* Setup form */
                    <form onSubmit={handleInitiateWill} className="p-4 rounded-xl border border-white/5 bg-white/[0.01] space-y-4">
                      <div className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                        <Mail className="w-4 h-4 text-rose-400" />
                        Designate Beneficiary
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-grow">
                          <input
                            type="email"
                            required
                            placeholder="beneficiary@example.com"
                            value={willBeneficiaryEmail}
                            onChange={(e) => setWillBeneficiaryEmail(e.target.value)}
                            disabled={willProcessing}
                            className="py-2.5 bg-black/40 text-xs w-full border border-white/5 rounded-lg px-3"
                          />
                        </div>
                        <button
                          type="submit"
                          className="btn btn-primary bg-rose-500 hover:bg-rose-600 text-white border-rose-500 px-6 py-2.5 text-xs font-bold shrink-0"
                          disabled={willProcessing}
                        >
                          Initiate Switch
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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Beneficiary User</span>
                          <span className="font-semibold text-white text-sm flex items-center gap-1.5">
                            <Mail className="w-4 h-4 text-secondary" />
                            {will.beneficiaryEmail}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-secondary uppercase tracking-wider block">Expiry Status</span>
                          <span className="font-bold text-teal-400 text-sm flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-teal-400" />
                            {getRemainingTimeText()}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-secondary leading-relaxed bg-white/[0.01] p-3 rounded-lg border border-white/5">
                        🛡️ **Auto-Postpone Active:** Your timer was automatically extended to 7 days when you opened this portfolio session today at **{will.lastSeenAt?.toDate()?.toLocaleTimeString()}**. 
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
