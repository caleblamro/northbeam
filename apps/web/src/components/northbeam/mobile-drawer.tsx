'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AppSidebar } from './app-sidebar';

// Slide-in sidebar for < 1024px. Backdrop closes; Escape closes; navigating
// closes; body scroll locks while open.
export function MobileDrawer({
  open,
  onClose,
  orgName,
  userName,
  userEmail,
}: {
  open: boolean;
  onClose: () => void;
  orgName: string;
  userName: string | null;
  userEmail: string;
}) {
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer whenever the route changes
  useEffect(() => {
    onClose();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="app-drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            className="app-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 40 }}
            style={{ borderRight: '1px solid var(--border)' }}
          >
            <AppSidebar
              orgName={orgName}
              userName={userName}
              userEmail={userEmail}
              onNavigate={onClose}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
