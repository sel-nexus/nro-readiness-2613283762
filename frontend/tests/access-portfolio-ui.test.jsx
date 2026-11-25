// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {webcrypto} from 'node:crypto';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import App from '../src/App.jsx';

beforeEach(() => {
  window.history.replaceState(null, '', '/login');
  // jsdom does not implement SubtleCrypto; use real Web Crypto for seeded login.
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function openPortfolio() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', {name: 'Continue as Marcus Hale'}));
  await screen.findByRole('heading', {name: 'West Metro Cluster 4', level: 1});
  return user;
}

async function openHarborPoint(user) {
  await user.click(screen.getByRole('link', {name: 'Review Harbor Point'}));
  await screen.findByRole('heading', {name: 'Harbor Point', level: 1});
  return screen.getByRole('combobox', {name: 'Search site id or name'});
}

describe('login form', () => {
  it('accepts the seeded password with an uppercase email and opens Marcus’s portfolio', async () => {
    const user = userEvent.setup();
    const name = 'Marcus Hale';
    render(<App />);
    await user.type(await screen.findByLabelText('Email'), 'MARCUS.HALE@HARBOR-RING.COM');
    await user.type(screen.getByLabelText('Password'), `Nr0-${name.split(' ')[0]}#1842`);
    await user.click(screen.getByRole('button', {name: 'Sign in', exact: true}));

    expect(await screen.findByRole('heading', {name: 'West Metro Cluster 4', level: 1})).toBeVisible();
    expect(screen.getByRole('button', {name: `${name} Rollout Manager`})).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Sign in'})).not.toBeInTheDocument();
  });

  it.each(['unknown@example.invalid', 'marcus.hale@harbor-ring.com'])(
    'shows the same credential error and clears the revealed password for %s', async email => {
      const user = userEvent.setup();
      render(<App />);
      const emailInput = await screen.findByLabelText('Email');
      const password = screen.getByLabelText('Password');
      await user.type(emailInput, email);
      await user.type(password, 'incorrect');
      await user.click(screen.getByRole('button', {name: 'Show password'}));
      expect(password).toHaveAttribute('type', 'text');
      await user.click(screen.getByRole('button', {name: 'Sign in', exact: true}));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.'));
      expect(emailInput).toHaveAccessibleDescription('Email or password is incorrect.');
      expect(password).toHaveValue('');
      expect(password).toHaveAttribute('type', 'password');
      expect(screen.getByRole('heading', {name: 'Sign in'})).toBeVisible();
      expect(screen.queryByRole('table', {name: 'Site readiness register'})).not.toBeInTheDocument();
    },
  );
});

describe('shell site lookup', () => {
  it('does not guess on ambiguous Enter and opens the keyboard-selected site', async () => {
    const user = await openPortfolio();
    const lookup = await openHarborPoint(user);
    await user.type(lookup, 'point{Enter}');

    const results = screen.getByRole('listbox', {name: 'Matching sites'});
    expect(within(results).getAllByRole('option')).toHaveLength(2);
    expect(within(results).queryByRole('option', {selected: true})).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Harbor Point', level: 1})).toBeVisible();

    await user.keyboard('{ArrowDown}');
    expect(within(results).getByRole('option', {selected: true})).toHaveTextContent('Point Richmond · NRO-W-1891');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', {name: 'Point Richmond', level: 1})).toBeVisible();
    expect(screen.queryByRole('listbox', {name: 'Matching sites'})).not.toBeInTheDocument();
  });

  it('offers no option for a design-only identifier and Escape closes the empty lookup without leaving the site', async () => {
    const user = await openPortfolio();
    const lookup = await openHarborPoint(user);
    await user.type(lookup, 'NRO-W-1902{Enter}');

    expect(screen.getByText('No site matches that name in West Metro Cluster 4.')).toBeVisible();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(lookup).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(lookup).toHaveAttribute('aria-expanded', 'false');
    expect(lookup).toHaveFocus();
    expect(screen.getByRole('heading', {name: 'Harbor Point', level: 1})).toBeVisible();
  });
});

describe('portfolio controls', () => {
  it('intersects search and risk filters, shows an empty result, and resets to the full register', async () => {
    const user = await openPortfolio();
    const register = within(screen.getByRole('table', {name: 'Site readiness register'}));
    const search = screen.getByRole('searchbox', {name: 'Search site id or name'});
    const filters = within(screen.getByRole('region', {name: 'Released-site filters'}));
    await user.type(search, ' 1842 ');
    expect(filters.getByRole('status')).toHaveTextContent('Showing 1 of 16 sites.');
    expect(register.getAllByRole('row')).toHaveLength(2);
    expect(register.getByRole('rowheader', {name: /Harbor Point/})).toBeVisible();

    await user.click(filters.getByRole('button', {name: 'Green', exact: true}));
    expect(filters.getByRole('button', {name: 'Green', pressed: true})).toBeVisible();
    expect(filters.getByRole('status')).toHaveTextContent('Showing 0 of 16 sites. No site matches that name');
    expect(register.queryByRole('rowheader')).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Portfolio totals'})).toHaveTextContent(/8\s*of 16 sites/);

    await user.clear(search);
    await user.click(filters.getByRole('button', {name: 'All', exact: true}));
    expect(filters.getByRole('status')).toHaveTextContent('Showing 16 of 16 sites.');
    expect(register.getAllByRole('row')).toHaveLength(17);
  });

  it('toggles readiness sort direction and keeps on-air sites after both orderings', async () => {
    const user = await openPortfolio();
    const register = within(screen.getByRole('table', {name: 'Site readiness register'}));
    const readiness = register.getByRole('columnheader', {name: 'Readiness'});
    const sort = within(readiness).getByRole('button', {name: 'Readiness'});

    await user.click(sort);
    expect(readiness).toHaveAttribute('aria-sort', 'ascending');
    expect(register.getAllByRole('rowheader')[0]).toHaveTextContent('Point Richmond');
    expect(register.getAllByRole('rowheader').at(-1)).toHaveTextContent('Temescal');

    await user.click(sort);
    expect(readiness).toHaveAttribute('aria-sort', 'descending');
    expect(register.getAllByRole('rowheader')[0]).toHaveTextContent('Civic Center');
    expect(register.getAllByRole('rowheader').at(-1)).toHaveTextContent('Temescal');
  });
});
