import { AuthSplitShell } from '@/components/northbeam/auth-shell';

// A1 split-panel shell for sign-in / verify: brand panel left, form right.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitShell width={400}>{children}</AuthSplitShell>;
}
