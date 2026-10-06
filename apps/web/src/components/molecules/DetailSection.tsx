import type { ReactNode } from 'react';
import { Section } from '@/components/molecules/Section';
import type { InfoTipItem } from '@/components/molecules/InfoTip';

/** A titled block on a detail page. Thin alias of Section kept for readability. */
export function DetailSection({
  title,
  description,
  children,
  help,
  actions,
  flush,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  help?: InfoTipItem[];
  actions?: ReactNode;
  flush?: boolean;
}) {
  return (
    <Section title={title} description={description} help={help} actions={actions} flush={flush}>
      {children}
    </Section>
  );
}
