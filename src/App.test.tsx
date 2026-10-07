import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell', () => {
  it('renders the desktop foundation workspace', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '静止画面剪切器' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '视频审核工作区' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开视频' })).toBeDisabled();
  });
});
