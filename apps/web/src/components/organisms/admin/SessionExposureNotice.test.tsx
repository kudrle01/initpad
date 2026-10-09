// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionExposureNotice } from './SessionExposureNotice';

afterEach(cleanup);

describe('SessionExposureNotice', () => {
  it('warns administrators when built-in applications share the InitPad host', () => {
    render(<SessionExposureNotice builtInAppsShareSession />);
    expect(screen.getByRole('status')).toHaveTextContent('Deployed applications can read sessions');
    expect(screen.getByRole('status')).toHaveTextContent('INITPAD_DEPLOY_PUBLIC_HOST');
  });

  it('stays hidden when applications cannot receive the session', () => {
    const { container } = render(<SessionExposureNotice builtInAppsShareSession={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
