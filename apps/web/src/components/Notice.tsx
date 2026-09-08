export type NoticeKind = 'info' | 'success' | 'error' | 'warning';

export function Notice({
  kind = 'info',
  title,
  children,
}: {
  kind?: NoticeKind;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`notice notice--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {title ? <strong>{title}</strong> : null}
      {title ? ' ' : null}
      {children}
    </div>
  );
}
