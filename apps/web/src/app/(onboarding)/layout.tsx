import { Wordmark } from '@/components/northbeam/primitives';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page)',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ marginBottom: 24 }}>
          <Wordmark size={18} />
        </div>
        <div className="intro-card" style={{ marginBottom: 0, padding: 28 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
