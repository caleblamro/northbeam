import { AuthSplitShell } from '@/components/northbeam/auth-shell';

// Same A1 split-panel shell as (auth) — workspace creation is part of the
// same arrival journey, so it keeps the same frame.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitShell width={440}>{children}</AuthSplitShell>;
}
