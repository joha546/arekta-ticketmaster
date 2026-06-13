import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the app title', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline in test')),
    );

    render(<App />);
    expect(screen.getByText('Arekta Ticketmaster')).toBeInTheDocument();
  });
});
