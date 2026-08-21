// web/src/test/setup.smoke.test.tsx
// Minimal smoke test proving the frontend test infrastructure works end-to-end:
// - React Testing Library can render a component in jsdom
// - `@/lib/api`'s exported functions can be mocked per-test via `vi.mock`
// This is infrastructure verification only; feature-specific tests belong to tasks 16.2-16.6.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CypherBlock } from '@/components/CypherBlock';
import * as api from '@/lib/api';

vi.mock('@/lib/api');

describe('frontend test infrastructure smoke test', () => {
  it('renders a component with React Testing Library and mocks lib/api functions', async () => {
    render(<CypherBlock cypher="MATCH (n) RETURN n" label="Test query" />);
    expect(screen.getByText('MATCH (n) RETURN n')).toBeInTheDocument();

    const mockData = [{ package: 'left-pad', compromised_versions: ['1.0.0'] }];
    vi.mocked(api.fetchCompromised).mockResolvedValue(mockData);

    const result = await api.fetchCompromised();

    expect(result).toEqual(mockData);
    expect(api.fetchCompromised).toHaveBeenCalledTimes(1);
  });
});
