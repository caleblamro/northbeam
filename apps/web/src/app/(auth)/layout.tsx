import { Wordmark } from '@/components/northbeam/primitives';

// Centered card shell for sign-in / verify.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-6">
          <Wordmark size={18} />
        </div>
        <div className="rounded-lg border border-border bg-card p-8">{children}</div>
      </div>
    </div>
  );
}
