// @vitest-environment happy-dom
/**
 * OriginIndicator 单测：透明度算法 + 渲染输出。
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OriginIndicator, __test__ } from '../../../../src/renderer/components/OriginIndicator.js';

describe('opacityFor (algorithm)', () => {
  it('returns low opacity when ts is missing', () => {
    expect(__test__.opacityFor(1000, undefined, 5000)).toBeCloseTo(0.2);
  });

  it('returns full opacity at ts === now', () => {
    expect(__test__.opacityFor(1000, 1000, 5000)).toBeCloseTo(1);
  });

  it('decays linearly inside recentMs window', () => {
    // 50% into window: opacity = 1 - 0.5*0.7 = 0.65
    expect(__test__.opacityFor(2500, 0, 5000)).toBeCloseTo(0.65);
  });

  it('settles to 0.25 outside recentMs', () => {
    expect(__test__.opacityFor(10_000, 0, 5000)).toBeCloseTo(0.25);
  });
});

describe('OriginIndicator', () => {
  it('renders three origin dots', () => {
    render(<OriginIndicator />);
    const indicator = screen.getByLabelText('origin-indicator');
    const dots = indicator.querySelectorAll('[data-origin]');
    expect(dots.length).toBe(3);
    expect(dots[0]?.getAttribute('data-origin')).toBe('ai');
    expect(dots[1]?.getAttribute('data-origin')).toBe('human');
    expect(dots[2]?.getAttribute('data-origin')).toBe('system');
  });

  it('applies pulse animation only to recently-active dots', () => {
    render(
      <OriginIndicator
        activity={{ ai: 999, human: 0 }}
        now={1000}
        recentMs={5000}
      />,
    );
    const indicator = screen.getByLabelText('origin-indicator');
    const ai = indicator.querySelector('[data-origin="ai"]');
    const human = indicator.querySelector('[data-origin="human"]');
    expect(ai?.className).toContain('animate-pulse');
    // human ts=0, delta=1000, < recentMs(5000) => pulse
    expect(human?.className).toContain('animate-pulse');
  });

  it('can render as an accessible Activity Center entry while preserving origin dots', () => {
    const open = vi.fn();

    render(
      <OriginIndicator
        activity={{ ai: 1000 }}
        now={1000}
        activityEntryLabel="Open activity for COM3"
        onOpenActivity={open}
      />,
    );

    const entry = screen.getByRole('button', { name: 'Open activity for COM3' });
    expect(entry.querySelectorAll('[data-origin]')).toHaveLength(3);

    fireEvent.click(entry);

    expect(open).toHaveBeenCalledOnce();
  });
});
