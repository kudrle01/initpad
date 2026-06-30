import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';

// Jednotný placeholder pro sekce, které jsou navržené, ale ještě nemají obsah.
export function ComingSoon({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <div className="coming-soon">
        <span className="coming-soon-icon">
          <Icon name={icon} size={26} />
        </span>
        <p className="coming-soon-lead">{children}</p>
        <span className="coming-soon-badge">Coming soon</span>
      </div>
    </div>
  );
}
