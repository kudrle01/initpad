// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppUrlLink } from './AppUrlLink';

afterEach(cleanup);

describe('AppUrlLink', () => {
  it('is underlined, larger and bold so the address stands out as a link', () => {
    render(<AppUrlLink url="https://app.example.test/" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://app.example.test/');
    expect(link).toHaveClass('underline');
    // A larger offset is clipped by the truncated text.
    expect(link).toHaveClass('underline-offset-2', 'text-sm', 'font-semibold');
    expect(link).toHaveTextContent('app.example.test/');
  });

  it('renders nothing for a non-http address', () => {
    const { container } = render(<AppUrlLink url="javascript:alert(1)" />);
    expect(container).toBeEmptyDOMElement();
  });
});
