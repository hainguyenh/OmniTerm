/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContributorsList from '../ContributorsList'

describe('ContributorsList', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders fallback contributors with repo owner first without numbers', () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    render(<ContributorsList />)

    expect(screen.getByText('Contributors')).toBeInTheDocument()
    expect(screen.getByText('the-long-ride')).toBeInTheDocument()
    expect(screen.getByText('hainguyenh')).toBeInTheDocument()

    const cards = screen.getAllByRole('link')
    expect(cards.length).toBe(2)
    // Repo owner hainguyenh is always first
    expect(cards[0]).toHaveAttribute('href', 'https://github.com/hainguyenh')
    expect(cards[1]).toHaveAttribute('href', 'https://github.com/the-long-ride')

    // Confirm no contribution numbers are shown in UI cards
    expect(screen.queryByText(/contribution/i)).not.toBeInTheDocument()
    expect(screen.queryByText('25000')).not.toBeInTheDocument()
  })

  it('fetches contributors stats from GitHub, keeps repo owner first, and sorts others by code changes', async () => {
    const mockStatsData = [
      {
        author: {
          login: 'contributor-b',
          id: 2,
          avatar_url: 'https://avatars.githubusercontent.com/u/2',
          html_url: 'https://github.com/contributor-b',
        },
        total: 50,
        weeks: [{ a: 10, d: 5, c: 50 }], // total code changes: 15
      },
      {
        author: {
          login: 'contributor-a',
          id: 1,
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
          html_url: 'https://github.com/contributor-a',
        },
        total: 20,
        weeks: [{ a: 200, d: 100, c: 20 }], // total code changes: 300
      },
      {
        author: {
          login: 'hainguyenh',
          id: 8667952,
          avatar_url: 'https://avatars.githubusercontent.com/u/8667952',
          html_url: 'https://github.com/hainguyenh',
        },
        total: 5,
        weeks: [{ a: 5, d: 5, c: 5 }], // total code changes: 10
      },
    ]

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockStatsData,
    } as Response)

    render(<ContributorsList />)

    await waitFor(() => {
      expect(screen.getByText('contributor-a')).toBeInTheDocument()
    })

    const cards = screen.getAllByRole('link')
    expect(cards.length).toBe(3)
    // Repo owner is first despite having fewest code changes
    expect(cards[0]).toHaveAttribute('href', 'https://github.com/hainguyenh')
    // Followed by most code changes
    expect(cards[1]).toHaveAttribute('href', 'https://github.com/contributor-a')
    expect(cards[2]).toHaveAttribute('href', 'https://github.com/contributor-b')
    // No numbers in UI
    expect(screen.queryByText(/contribution/i)).not.toBeInTheDocument()
    expect(screen.queryByText('300')).not.toBeInTheDocument()
  })
})
