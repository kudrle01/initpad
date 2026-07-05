import { Atom, Box, Braces, Coffee, FileCode2, Globe, Hexagon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Atom: colored technology icon of a template. Matched by template id /
// language; unknown technologies fall back to a neutral box.
interface Tech {
  icon: LucideIcon;
  color: string; // icon color; the chip background is the same color at low alpha
  match: RegExp;
}

const TECHS: Tech[] = [
  { icon: Atom, color: '#185FA5', match: /react|next/i },
  { icon: Hexagon, color: '#3B6D11', match: /node|express|javascript|typescript/i },
  { icon: Braces, color: '#A32D2D', match: /nest/i },
  { icon: Coffee, color: '#993C1D', match: /java|spring|kotlin/i },
  { icon: FileCode2, color: '#534AB7', match: /php/i },
  { icon: Braces, color: '#2E6B8A', match: /python|fastapi|django/i },
  { icon: Globe, color: '#7A5A44', match: /static|html|astro/i },
];

const SIZES = {
  sm: { chip: 'h-8 w-8 rounded-md', icon: 'h-4 w-4' },
  md: { chip: 'h-10 w-10 rounded-md', icon: 'h-5 w-5' },
  lg: { chip: 'h-11 w-11 rounded-lg', icon: 'h-[22px] w-[22px]' },
} as const;

export function TemplateIcon({
  templateId,
  language,
  size = 'md',
  className,
}: {
  templateId?: string;
  language?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const key = `${templateId ?? ''} ${language ?? ''}`;
  const tech = TECHS.find((t) => t.match.test(key));
  const I = tech?.icon ?? Box;
  const s = SIZES[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center',
        s.chip,
        !tech && 'bg-secondary',
        className,
      )}
      style={
        tech
          ? { color: tech.color, backgroundColor: `${tech.color}1c` }
          : undefined
      }
    >
      <I className={cn(s.icon, !tech && 'text-muted-foreground')} />
    </span>
  );
}
