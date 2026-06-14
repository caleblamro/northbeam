import { SetupShell } from '@/components/northbeam/setup-shell';
import type { ReactNode } from 'react';

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <SetupShell>{children}</SetupShell>;
}
