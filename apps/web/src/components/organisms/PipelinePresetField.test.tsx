// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelinePresetField } from './PipelinePresetField';

afterEach(cleanup);

describe('PipelinePresetField', () => {
  it('shows all supported presets and reports the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PipelinePresetField value="dev-test-prod" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: /development, test, production/i })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    await user.click(screen.getByText('Production only'));
    expect(onChange).toHaveBeenCalledWith('prod-only');
  });
});
