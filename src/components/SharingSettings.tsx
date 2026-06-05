import React, { useState, useEffect } from 'react';
import type { Portfolio, SharePermission } from '../types';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, Trash2, Shield, Eye, ShieldAlert, FolderHeart } from 'lucide-react';

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

  const isOwner = activePortfolio && user && activePortfolio.ownerId === user.uid;

  // Load portfolios shared with me
  useEffect(() => {
    const loadSharedPortfolios = async () => {
      if (!user || !user.email) return;
      try {
        setLoadingShared(true);
        const colRef = collection(db, 'portfolios');
        const q = query(colRef, where('sharedWithEmails', 'array-contains', user.email));
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

    // Check if email already shared
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Access Control</h2>
        <p className="text-secondary text-sm">Manage access permissions for this portfolio and view folders shared with you.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Manage Sharing for Active Portfolio */}
        <div className="lg:col-span-2 space-y-4">
          {!activePortfolio ? (
            <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
              <Users className="w-16 h-16 text-muted mb-4" />
              <h3 className="text-xl font-bold mb-2">No Active Portfolio</h3>
              <p className="text-secondary max-w-sm">
                Please select or create a portfolio from the sidebar workspace dropdown to configure sharing access.
              </p>
            </div>
          ) : (
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
                        className="py-2.5"
                      />
                    </div>
                    <div className="w-full sm:w-[150px]">
                      <select
                        value={permission}
                        onChange={(e) => setPermission(e.target.value as any)}
                        disabled={processing}
                        className="py-2.5"
                      >
                        <option value="read">Read Only</option>
                        <option value="write">Read & Write</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary px-6"
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

              {/* List of current share permissions */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-secondary uppercase tracking-wider">Collaborators</div>
                
                <div className="divide-y divide-white/5">
                  {/* Owner details */}
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
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center gap-1">
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
                          <span className={`text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
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
          )}
        </div>

        {/* Portfolios Shared with Me */}
        <div className="space-y-4">
          <div className="glass-panel p-6 border-white/5 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <FolderHeart className="w-5 h-5 text-indigo-400" />
              Shared Portfolios
            </h3>
            
            <p className="text-xs text-secondary leading-relaxed">
              These portfolios belong to other users who have invited you as a viewer or editor. Click to switch view.
            </p>

            <div className="divide-y divide-white/5">
              {loadingShared ? (
                <div className="py-6 text-center text-xs text-muted flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                  Checking shares...
                </div>
              ) : sharedPortfolios.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted">
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
        </div>
      </div>
    </div>
  );
};
