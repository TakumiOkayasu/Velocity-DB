import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import App from '../App';

describe('App', () => {
  it('renders the main database controls', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '接続' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '実行' })).toBeDisabled();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
