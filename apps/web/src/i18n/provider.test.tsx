// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageMenuItems, LanguageToggle } from '@/components/molecules/LanguageSwitch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLocale, t } from '@/i18n';
import { I18nProvider } from './provider';

afterEach(() => {
  cleanup();
  setLocale('en');
});

// A component, as in the app: text is produced when the subtree renders.
function Greeting() {
  return <p>{t('Sign in')}</p>;
}

describe('language switch', () => {
  it('translates the whole subtree and returns focus to the switch', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LanguageToggle />
        <Greeting />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Čeština (CZ)' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.getByText('Přihlásit se')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Jazyk' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('cs');
    const czech = screen.getByRole('button', { name: 'Čeština (CZ)' });
    expect(czech).toHaveAttribute('aria-pressed', 'true');
    expect(czech).toHaveFocus();
  });

  it('returns focus to the account menu trigger after choosing a language', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <DropdownMenu>
          <DropdownMenuTrigger data-language-control>account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <LanguageMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      </I18nProvider>,
    );

    await user.tab();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Čeština' }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(document.documentElement.lang).toBe('cs');
    await waitFor(() => expect(screen.getByRole('button', { name: 'account' })).toHaveFocus());
    // The modal menu must not leave the remounted page inert.
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});
