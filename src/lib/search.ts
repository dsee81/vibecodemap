import { SEARCH_INDEX } from '../data/singaporePlaces'
import type { MarkerIcon, SearchPlace } from '../types'

type NominatimResult = {
  lat: string
  lon: string
  name?: string
  display_name?: string
  address?: Record<string, string | undefined>
  type?: string
  class?: string
}

export type SearchSuggestion = SearchPlace & {
  source: 'starter' | 'nominatim'
  subtitle: string
}

const CACHE_KEY = 'sg-map-search-cache-v1'

export const STARTER_SEARCH_SUGGESTIONS: SearchSuggestion[] = SEARCH_INDEX.slice(0, 8).map((place) => ({
  ...place,
  source: 'starter',
  subtitle: `${place.neighbourhood} | ${formatLabel(place.category)}`,
}))

export async function searchSingaporePlaces(query: string) {
  const trimmed = query.trim()
  if (!trimmed) {
    return STARTER_SEARCH_SUGGESTIONS
  }

  const cache = readCache()
  const cached = cache[trimmed.toLowerCase()]
  if (cached?.length) {
    return cached
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=sg&limit=10&addressdetails=1&q=${encodeURIComponent(trimmed)}`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error('Singapore location search is temporarily unavailable.')
  }

  const payload = (await response.json()) as NominatimResult[]
  const suggestions = dedupeSuggestions(
    payload
      .map((row): SearchSuggestion | null => {
        const lat = Number(row.lat)
        const lng = Number(row.lon)

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null
        }

        const title = row.name || firstNamedSegment(row.display_name) || trimmed
        const neighbourhood =
          row.address?.suburb ||
          row.address?.neighbourhood ||
          row.address?.quarter ||
          row.address?.city_district ||
          row.address?.road ||
          'Singapore'
        const category = inferCategory(`${row.type ?? ''} ${row.class ?? ''} ${title} ${row.display_name ?? ''}`)

        return {
          title,
          lat,
          lng,
          neighbourhood,
          category,
          source: 'nominatim',
          subtitle: row.display_name || neighbourhood,
        }
      })
      .filter((row): row is SearchSuggestion => row !== null),
  )

  if (suggestions.length) {
    writeCache(trimmed.toLowerCase(), suggestions)
    return suggestions
  }

  return searchStarterFallback(trimmed)
}

function dedupeSuggestions(items: SearchSuggestion[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.title}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function inferCategory(text: string): MarkerIcon {
  const value = text.toLowerCase()

  if (/(hawker|food|market|restaurant|laksa|satay|kitchen|eatery)/.test(value)) {
    return 'food'
  }

  if (/(cafe|coffee|kopi|espresso|roastery)/.test(value)) {
    return 'cafe'
  }

  if (/(hike|trail|nature|reservoir|forest|treetop|macritchie|bukit timah|southern ridges)/.test(value)) {
    return 'hike'
  }

  if (/(shopping|shop|mall|retail|boutique|plaza|centre|center)/.test(value)) {
    return 'shopping'
  }

  if (/(movie|cinema|theatre|theater|imax|film|golden village|shaw|cathay)/.test(value)) {
    return 'movie'
  }

  if (/(museum|gallery|library|heritage|temple)/.test(value)) {
    return 'museum'
  }

  if (/(park|garden|zoo|bay|beach|island|station|airport|harbour)/.test(value)) {
    return 'attraction'
  }

  return 'custom'
}

function formatLabel(category: MarkerIcon) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function searchStarterFallback(query: string) {
  const lowered = query.toLowerCase()
  return STARTER_SEARCH_SUGGESTIONS.filter((place) => {
    const haystack = `${place.title} ${place.neighbourhood} ${place.subtitle}`.toLowerCase()
    return haystack.includes(lowered)
  })
}

function firstNamedSegment(displayName?: string) {
  if (!displayName) {
    return ''
  }

  return displayName.split(',')[0]?.trim() ?? ''
}

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, SearchSuggestion[]>) : {}
  } catch {
    return {}
  }
}

function writeCache(query: string, suggestions: SearchSuggestion[]) {
  try {
    const next = { ...readCache(), [query]: suggestions }
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    // Ignore cache writes if localStorage is unavailable.
  }
}
