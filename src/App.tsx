import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import maplibregl, { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl'
import type { LngLatLike } from 'maplibre-gl'
import { createBackend } from './lib/backend'
import { compressImage } from './lib/image'
import { searchSingaporePlaces, STARTER_SEARCH_SUGGESTIONS } from './lib/search'
import type { SearchSuggestion } from './lib/search'
import type { DraftPlace, MarkerIcon, PlaceRecord, PlaceSourceType, WorkspaceContext } from './types'
import './App.css'

const MAP_CENTER: LngLatLike = [103.8198, 1.3521]
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DEFAULT_SLUG = 'singapore-shared'
const DEFAULT_LOCAL_KEY = 'local-share'
const MAX_PHOTOS = 4
const STAR_GLYPH = '\u2605'
const TAG_OPTIONS = [
  'MUST GO BACK!!!',
  'Worth queueing',
  'Late-night',
  'hIdDeN gEm?!1',
  'Brunch',
  'Lunch',
  'Dinner',
  'Brekkie',
  'Good date spot!',
]

const CATEGORY_META: Record<MarkerIcon, { label: string; emoji: string; sticker: string }> = {
  food: { label: 'Food', emoji: '\uD83C\uDF5C', sticker: 'Visited' },
  attraction: { label: 'Attraction', emoji: '\uD83D\uDCCD', sticker: 'Visited' },
  museum: { label: 'Museum', emoji: '\uD83C\uDFDB\uFE0F', sticker: 'Visited' },
  cafe: { label: 'Cafe', emoji: '\u2615', sticker: 'Visited' },
  hike: { label: 'Hike', emoji: '\uD83E\uDD7E', sticker: 'Visited' },
  shopping: { label: 'Shopping', emoji: '\uD83D\uDECD\uFE0F', sticker: 'Visited' },
  movie: { label: 'Movie', emoji: '\uD83C\uDFAC', sticker: 'Visited' },
  custom: { label: 'Custom', emoji: '\u2B50', sticker: 'Visited' },
}

type Notice = {
  tone: 'neutral' | 'success' | 'error'
  message: string
}

type FormState = {
  title: string
  category: MarkerIcon
  visited: boolean
  dateVisited: string
  comment: string
  rating: number
  favorite: boolean
  tags: string[]
  photoUrls: string[]
}

type PendingPhoto = {
  id: string
  name: string
  file: File
  previewUrl: string
}

type ListFilters = {
  query: string
  category: MarkerIcon | 'all'
  visited: 'all' | 'visited' | 'planned'
  favorite: boolean
  dateVisited: string
  tag: string
}

const EMPTY_FORM: FormState = {
  title: '',
  category: 'custom',
  visited: false,
  dateVisited: '',
  comment: '',
  rating: 0,
  favorite: false,
  tags: [],
  photoUrls: [],
}

const backend = createBackend()

function parseWorkspaceFromUrl() {
  const url = new URL(window.location.href)
  const slugMatch = url.pathname.match(/\/map\/([^/]+)/)
  const slug = slugMatch?.[1] ?? DEFAULT_SLUG
  const shareKey = url.searchParams.get('key') ?? DEFAULT_LOCAL_KEY
  return { slug, shareKey, url }
}

function formatModeLabel(context: WorkspaceContext | null) {
  if (!context) {
    return 'Connecting'
  }

  return context.mode === 'supabase' ? 'Live shared mode' : 'Demo local mode'
}

function markerClassName(icon: MarkerIcon, visited: boolean, favorite: boolean) {
  return `marker marker--${icon} ${visited ? 'marker--visited' : 'marker--planned'} ${favorite ? 'marker--favorite' : ''}`
}

function createMarkerElement(place: PlaceRecord) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = markerClassName(place.markerIcon, place.visited, place.favorite)
  button.setAttribute('aria-label', place.title)

  const emblem = document.createElement('span')
  emblem.className = 'marker__emblem'
  emblem.textContent = CATEGORY_META[place.markerIcon].emoji
  button.appendChild(emblem)

  const sticker = document.createElement('span')
  sticker.className = place.visited ? 'marker__sticker' : 'marker__sticker marker__sticker--planned'
  sticker.textContent = place.visited ? CATEGORY_META[place.markerIcon].sticker : 'Planned'
  button.appendChild(sticker)

  if (place.favorite) {
    const favorite = document.createElement('span')
    favorite.className = 'marker__favorite'
    favorite.textContent = '\u2665'
    button.appendChild(favorite)
  }

  return button
}

function toFormState(place?: DraftPlace | PlaceRecord | null): FormState {
  if (!place) {
    return EMPTY_FORM
  }

  return {
    title: place.title,
    category: place.category,
    visited: place.visited,
    dateVisited: 'dateVisited' in place && place.dateVisited ? place.dateVisited : '',
    comment: 'comment' in place ? place.comment : '',
    rating: 'rating' in place ? place.rating : 0,
    favorite: 'favorite' in place ? place.favorite : false,
    tags: 'tags' in place ? place.tags : [],
    photoUrls: 'photoUrls' in place ? place.photoUrls : [],
  }
}

function isExistingPlace(place: DraftPlace | PlaceRecord | null): place is PlaceRecord {
  return Boolean(place && 'id' in place)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(date: string | null) {
  if (!date) {
    return 'No visit date'
  }

  return new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatMonth(date: string | null) {
  if (!date) {
    return 'Undated'
  }

  return new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', {
    month: 'long',
    year: 'numeric',
  })
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong.'
}

function App() {
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const popupRef = useRef<Popup | null>(null)
  const pendingPhotoPreviewUrlsRef = useRef<Set<string>>(new Set())
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null)
  const [places, setPlaces] = useState<PlaceRecord[]>([])
  const [selectedPlace, setSelectedPlace] = useState<DraftPlace | PlaceRecord | null>(null)
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM)
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>(STARTER_SEARCH_SUGGESTIONS)
  const [isSearching, setIsSearching] = useState(false)
  const [listFilters, setListFilters] = useState<ListFilters>({
    query: '',
    category: 'all',
    visited: 'all',
    favorite: false,
    dateVisited: '',
    tag: '',
  })
  const [notice, setNotice] = useState<Notice>({
    tone: 'neutral',
    message: 'Opening workspace...',
  })
  const [isSaving, setIsSaving] = useState(false)

  const listFilteredPlaces = useMemo(() => {
    return places.filter((place) => {
      if (listFilters.category !== 'all' && place.category !== listFilters.category) {
        return false
      }

      if (listFilters.visited === 'visited' && !place.visited) {
        return false
      }

      if (listFilters.visited === 'planned' && place.visited) {
        return false
      }

      if (listFilters.favorite && !place.favorite) {
        return false
      }

      if (listFilters.dateVisited && place.dateVisited !== listFilters.dateVisited) {
        return false
      }

      if (listFilters.tag && !place.tags.includes(listFilters.tag)) {
        return false
      }

      if (listFilters.query.trim()) {
        const haystack = `${place.title} ${place.comment} ${place.category} ${place.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(listFilters.query.trim().toLowerCase())) {
          return false
        }
      }

      return true
    })
  }, [listFilters, places])

  const timelinePlaces = useMemo(() => {
    return [...places]
      .filter((place) => place.visited && place.dateVisited)
      .sort((left, right) => (right.dateVisited ?? '').localeCompare(left.dateVisited ?? ''))
  }, [places])

  const timelineGroups = useMemo(() => {
    return timelinePlaces.reduce<Array<{ month: string; places: PlaceRecord[] }>>((groups, place) => {
      const month = formatMonth(place.dateVisited)
      const group = groups.find((item) => item.month === month)
      if (group) {
        group.places.push(place)
      } else {
        groups.push({ month, places: [place] })
      }

      return groups
    }, [])
  }, [timelinePlaces])

  const totalPhotoCount = formState.photoUrls.length + pendingPhotos.length

  useEffect(() => {
    const { slug, shareKey, url } = parseWorkspaceFromUrl()

    if (!url.pathname.startsWith('/map/')) {
      window.history.replaceState({}, '', `/map/${slug}?key=${shareKey}`)
    }

    let ignore = false

    async function initializeWorkspace() {
      try {
        const context = await backend.initialize({ slug, shareKey })
        if (ignore) {
          return
        }

        setWorkspaceContext(context)
        setNotice({
          tone: context.mode === 'supabase' ? 'success' : 'neutral',
          message:
            context.mode === 'supabase'
              ? 'Connected to Supabase realtime workspace.'
              : 'Running in local demo mode because Supabase env vars are missing.',
        })

        const initialPlaces = await backend.listPlaces(context.workspace.id)
        if (ignore) {
          return
        }

        setPlaces(initialPlaces)
        const unsubscribe = backend.subscribe(context.workspace.id, setPlaces)
        return () => unsubscribe()
      } catch (error) {
        if (!ignore) {
          setNotice({
            tone: 'error',
            message: error instanceof Error ? error.message : 'Failed to open the workspace.',
          })
        }
      }
    }

    let cleanup: (() => void) | undefined

    initializeWorkspace().then((maybeCleanup) => {
      cleanup = maybeCleanup
    })

    return () => {
      ignore = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const previewUrls = pendingPhotoPreviewUrlsRef.current

    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url))
      previewUrls.clear()
    }
  }, [])

  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) {
      return
    }

    const markers = markersRef.current
    const map = new maplibregl.Map({
      container: mapHostRef.current,
      style: MAP_STYLE,
      center: MAP_CENTER,
      zoom: 10.8,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('click', (event) => {
      const draft: DraftPlace = {
        title: 'New custom pin',
        lat: Number(event.lngLat.lat.toFixed(6)),
        lng: Number(event.lngLat.lng.toFixed(6)),
        category: 'custom',
        markerIcon: 'custom',
        visited: false,
        dateVisited: null,
        tags: [],
        sourceType: 'custom',
      }

      setSelectedPlace(draft)
      setFormState(toFormState(draft))
      clearPendingPhotos()
    })

    mapRef.current = map

    return () => {
      markers.forEach((marker) => marker.remove())
      markers.clear()
      popupRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()

    places.forEach((place) => {
      const element = createMarkerElement(place)
      const openPlace = (event?: Event) => {
        event?.stopPropagation()
        setSelectedPlace(place)
        setFormState(toFormState(place))
        clearPendingPhotos()
        map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 13.5) })
      }

      element.addEventListener('pointerdown', (event) => event.stopPropagation())
      element.addEventListener('mousedown', (event) => event.stopPropagation())
      element.addEventListener('click', openPlace)

      const marker = new maplibregl.Marker({
        element,
        anchor: 'bottom',
      })
        .setLngLat([place.lng, place.lat])
        .addTo(map)

      markersRef.current.set(place.id, marker)
    })
  }, [places])

  useEffect(() => {
    const map = mapRef.current
    if (!selectedPlace || !map) {
      popupRef.current?.remove()
      return
    }

    map.flyTo({
      center: [selectedPlace.lng, selectedPlace.lat],
      zoom: Math.max(map.getZoom(), 13),
    })

    const tagsMarkup =
      isExistingPlace(selectedPlace) && selectedPlace.tags.length
        ? `<br/>Tags: ${selectedPlace.tags.map((tag) => escapeHtml(tag)).join(', ')}`
        : ''

    const details = isExistingPlace(selectedPlace)
      ? `<strong>${escapeHtml(selectedPlace.title)}</strong><br/>${escapeHtml(
          CATEGORY_META[selectedPlace.category].label,
        )} | ${selectedPlace.visited ? 'Visited' : 'Planned'}<br/>Rating: ${
          selectedPlace.rating > 0 ? `${selectedPlace.rating}/5` : 'Not rated yet'
        }<br/>Visit date: ${escapeHtml(formatDate(selectedPlace.dateVisited))}${tagsMarkup}`
      : `<strong>${escapeHtml(selectedPlace.title)}</strong><br/>New ${escapeHtml(
          CATEGORY_META[selectedPlace.category].label.toLowerCase(),
        )} pin`

    popupRef.current?.remove()
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      offset: 24,
      maxWidth: '260px',
    })
      .setLngLat([selectedPlace.lng, selectedPlace.lat])
      .setHTML(details)
      .addTo(map)
  }, [selectedPlace])

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormState((current) => ({ ...current, [key]: value }))
  }

  function clearPendingPhotos() {
    setPendingPhotos((current) => {
      current.forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl)
        pendingPhotoPreviewUrlsRef.current.delete(photo.previewUrl)
      })
      return []
    })
  }

  function removePendingPhoto(id: string) {
    setPendingPhotos((current) => {
      const removed = current.find((photo) => photo.id === id)
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl)
        pendingPhotoPreviewUrlsRef.current.delete(removed.previewUrl)
      }

      return current.filter((photo) => photo.id !== id)
    })
  }

  function toggleTag(tag: string) {
    setFormState((current) => ({
      ...current,
      tags: current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag],
    }))
  }

  function chooseSuggestion(index: SearchSuggestion) {
    const savedPlace = places.find(
      (place) =>
        Math.abs(place.lat - index.lat) < 0.00005 &&
        Math.abs(place.lng - index.lng) < 0.00005 &&
        place.title.toLowerCase() === index.title.toLowerCase(),
    )

    if (savedPlace) {
      setSelectedPlace(savedPlace)
      setFormState(toFormState(savedPlace))
      clearPendingPhotos()
      return
    }

    const draft: DraftPlace = {
      title: index.title,
      lat: index.lat,
      lng: index.lng,
      category: index.category,
      markerIcon: index.category,
      visited: false,
      dateVisited: null,
      tags: [],
      sourceType: 'search',
    }

    setSelectedPlace(draft)
    setFormState(toFormState(draft))
    clearPendingPhotos()
  }

  async function handleSearchSubmit(event: FormEvent) {
    event.preventDefault()
    setIsSearching(true)

    try {
      const results = await searchSingaporePlaces(search)
      setSuggestions(results)
      if (!results.length) {
        setNotice({
          tone: 'neutral',
          message: 'No matching places found. You can still click the map to add a custom pin.',
        })
      }
    } catch (error) {
      setSuggestions(STARTER_SEARCH_SUGGESTIONS)
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Search is temporarily unavailable.',
      })
    } finally {
      setIsSearching(false)
    }
  }

  async function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) {
      return
    }

    const availableSlots = MAX_PHOTOS - totalPhotoCount
    const files = Array.from(event.target.files).slice(0, availableSlots)
    if (!files.length) {
      event.target.value = ''
      return
    }

    setIsSaving(true)

    try {
      const nextPhotos: PendingPhoto[] = []
      for (const file of files) {
        const compressed = await compressImage(file)
        const previewUrl = URL.createObjectURL(compressed)
        pendingPhotoPreviewUrlsRef.current.add(previewUrl)
        nextPhotos.push({
          id: crypto.randomUUID(),
          name: compressed.name,
          file: compressed,
          previewUrl,
        })
      }

      setPendingPhotos((current) => [...current, ...nextPhotos])
      setNotice({
        tone: 'neutral',
        message: `Ready to save ${nextPhotos.length} photo${nextPhotos.length === 1 ? '' : 's'} with this place.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Photo upload failed.',
      })
    } finally {
      setIsSaving(false)
      event.target.value = ''
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!workspaceContext || !selectedPlace) {
      return
    }

    setIsSaving(true)

    try {
      const sourceType: PlaceSourceType = selectedPlace.sourceType
      let uploadedPhotoUrls: string[] = []

      if (pendingPhotos.length) {
        setNotice({
          tone: 'neutral',
          message: `Uploading ${pendingPhotos.length} photo${pendingPhotos.length === 1 ? '' : 's'}...`,
        })

        try {
          uploadedPhotoUrls = await Promise.all(
            pendingPhotos.map((photo) => backend.uploadPhoto(workspaceContext.workspace.id, photo.file)),
          )
        } catch (error) {
          throw new Error(
            `Photo upload did not complete. Check the Supabase Storage bucket and upload policy. ${toErrorMessage(error)}`,
          )
        }
      }

      const photoUrls = [...formState.photoUrls, ...uploadedPhotoUrls]
      const removedPhotoUrls = isExistingPlace(selectedPlace)
        ? selectedPlace.photoUrls.filter((url) => !photoUrls.includes(url))
        : []
      setNotice({
        tone: 'neutral',
        message: uploadedPhotoUrls.length ? 'Saving place with uploaded photos...' : 'Saving place...',
      })

      const saved = await backend.savePlace({
        workspaceId: workspaceContext.workspace.id,
        placeId: isExistingPlace(selectedPlace) ? selectedPlace.id : undefined,
        title: formState.title.trim() || 'Untitled place',
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
        category: formState.category,
        markerIcon: formState.category,
        visited: formState.visited,
        dateVisited: formState.visited ? formState.dateVisited || null : null,
        sourceType,
        comment: formState.comment.trim(),
        rating: formState.rating,
        favorite: formState.favorite,
        tags: formState.tags,
        photoUrls,
      })

      if (removedPhotoUrls.length) {
        try {
          await backend.deletePhotos(removedPhotoUrls)
        } catch (error) {
          setNotice({
            tone: 'neutral',
            message: `Saved place, but removed photo files could not be cleaned up. ${toErrorMessage(error)}`,
          })
        }
      }

      const refreshedPlaces = await backend.listPlaces(workspaceContext.workspace.id)
      const refreshedSaved = refreshedPlaces.find((place) => place.id === saved.id) ?? saved

      setPlaces(refreshedPlaces)
      setSelectedPlace(refreshedSaved)
      setFormState(toFormState(refreshedSaved))
      clearPendingPhotos()
      setNotice({
        tone: 'success',
        message: `Saved ${refreshedSaved.title}${
          uploadedPhotoUrls.length
            ? ` with ${uploadedPhotoUrls.length} photo${uploadedPhotoUrls.length === 1 ? '' : 's'}`
            : ''
        }.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to save the place.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeletePlace() {
    if (!workspaceContext || !isExistingPlace(selectedPlace)) {
      return
    }

    setIsSaving(true)

    try {
      await backend.deletePlace(workspaceContext.workspace.id, selectedPlace.id)
      setPlaces((current) => current.filter((place) => place.id !== selectedPlace.id))
      setSelectedPlace(null)
      setFormState(EMPTY_FORM)
      clearPendingPhotos()
      popupRef.current?.remove()
      setNotice({
        tone: 'success',
        message: 'Pin deleted.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete the pin.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const shareLink = workspaceContext
    ? `${window.location.origin}/map/${workspaceContext.workspace.slug}?key=${workspaceContext.workspace.shareKey}`
    : window.location.href

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="hero-panel">
          <p className="eyebrow">Shared map</p>
          <h1>zhi ning and davin&apos;s map of wonderful places that we have gone to &lt;3</h1>
          <div className="hero-stats" aria-label="Map summary">
            <span>{places.length} places</span>
            <span>{places.filter((place) => place.visited).length} visited</span>
            <span>{places.filter((place) => place.favorite).length} favorites</span>
          </div>
        </header>

        <section className="status-card">
          <div>
            <p className="label">Mode</p>
            <strong>{formatModeLabel(workspaceContext)}</strong>
          </div>
          <p className={`notice notice--${notice.tone}`}>{notice.message}</p>
          <label className="share-field">
            <span>Share link</span>
            <input value={shareLink} readOnly />
          </label>
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <p className="label">Search places</p>
              <h2>Search for a location here!</h2>
            </div>
            <span className="pill">{isSearching ? 'Searching...' : 'Manual search'}</span>
          </div>
          <form className="search-form" onSubmit={handleSearchSubmit}>
            <label className="search-box">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search any Singapore address, MRT, mall, or landmark..."
              />
            </label>
            <button className="search-button" type="submit" disabled={isSearching}>
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>
          <div className="suggestions">
            {suggestions.map((candidate) => (
              <button key={`${candidate.title}-${candidate.lat}`} type="button" onClick={() => chooseSuggestion(candidate)}>
                <span>{candidate.title}</span>
                <small>{candidate.subtitle}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="editor-card">
          <div className="panel-heading">
            <div>
              <p className="label">Place editor</p>
              <h2>{selectedPlace ? formState.title || 'Untitled place' : 'Select or create a place'}</h2>
            </div>
            {selectedPlace ? (
              <span className="pill">
                {CATEGORY_META[formState.category].label} | {formState.visited ? 'Visited' : 'Planned'}
              </span>
            ) : null}
          </div>

          {selectedPlace ? (
            <form className="editor-form" onSubmit={handleSubmit}>
              {isExistingPlace(selectedPlace) ? (
                <section className="place-summary" aria-label="Selected place summary">
                  {formState.photoUrls[0] ? (
                    <button className="place-summary__photo" type="button" onClick={() => setLightboxPhoto(formState.photoUrls[0])}>
                      <img src={formState.photoUrls[0]} alt={formState.title} />
                    </button>
                  ) : (
                    <div className="place-summary__empty">{CATEGORY_META[formState.category].emoji}</div>
                  )}
                  <div className="place-summary__body">
                    <div className="place-summary__title">
                      <strong>{formState.title}</strong>
                      {formState.favorite ? <span className="heart-pill">Hearted</span> : null}
                    </div>
                    <div className="pin-card__meta">
                      <span>{CATEGORY_META[formState.category].label}</span>
                      <span>{formState.visited ? 'Visited' : 'Planned'}</span>
                      <span>{formatDate(formState.dateVisited || null)}</span>
                      <span>{formState.rating > 0 ? `${formState.rating}/5 stars` : 'Unrated'}</span>
                    </div>
                    {formState.comment ? <p>{formState.comment}</p> : null}
                  </div>
                </section>
              ) : null}

              <label>
                <span>Place name</span>
                <input value={formState.title} onChange={(event) => updateForm('title', event.target.value)} required />
              </label>

              <label>
                <span>Category</span>
                <select
                  value={formState.category}
                  onChange={(event) => updateForm('category', event.target.value as MarkerIcon)}
                >
                  {Object.entries(CATEGORY_META).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.emoji} {value.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid-two">
                <label className="visit-toggle">
                  <span>Visited</span>
                  <button
                    type="button"
                    className={formState.visited ? 'toggle toggle--active' : 'toggle'}
                    onClick={() =>
                      setFormState((current) => ({
                        ...current,
                        visited: !current.visited,
                        dateVisited:
                          !current.visited && !current.dateVisited
                            ? new Date().toISOString().slice(0, 10)
                            : current.visited
                              ? ''
                              : current.dateVisited,
                      }))
                    }
                  >
                    {formState.visited ? 'Visited sticker on' : 'Mark as visited'}
                  </button>
                </label>

                <label>
                  <span>Date visited</span>
                  <input
                    type="date"
                    value={formState.dateVisited}
                    onChange={(event) => updateForm('dateVisited', event.target.value)}
                    disabled={!formState.visited}
                  />
                </label>
              </div>

              <button
                type="button"
                className={formState.favorite ? 'favorite-toggle favorite-toggle--active' : 'favorite-toggle'}
                onClick={() => updateForm('favorite', !formState.favorite)}
              >
                {formState.favorite ? 'Hearted place' : 'Mark as favorite'}
              </button>

              <div className="rating-block">
                <span className="label label--compact">Rating</span>
                <div className="star-row">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={star <= formState.rating ? 'star-button star-button--active' : 'star-button'}
                      onClick={() => updateForm('rating', star)}
                      aria-label={`Rate ${star} out of 5`}
                    >
                      {STAR_GLYPH}
                    </button>
                  ))}
                  {formState.rating > 0 ? (
                    <button type="button" className="clear-rating" onClick={() => updateForm('rating', 0)}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="tags-block">
                <span className="label label--compact">Tags and badges</span>
                <div className="tags-grid">
                  {TAG_OPTIONS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={formState.tags.includes(tag) ? 'tag-chip tag-chip--active' : 'tag-chip'}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <label>
                <span>Shared notes</span>
                <textarea
                  rows={5}
                  value={formState.comment}
                  onChange={(event) => updateForm('comment', event.target.value)}
                  placeholder="Best dishes, opening hours, what to revisit, what to skip..."
                />
              </label>

              <div className="photo-block">
                <div className="panel-heading">
                  <div>
                    <p className="label">Photos</p>
                    <h2>Saved with the place</h2>
                  </div>
                  <span className="pill">
                    {totalPhotoCount}/{MAX_PHOTOS}
                  </span>
                </div>
                <label className="upload-button">
                  <span>Add photos</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoSelection}
                    disabled={isSaving || totalPhotoCount >= MAX_PHOTOS}
                  />
                </label>
                {pendingPhotos.length ? (
                  <p className="photo-save-note">
                    {pendingPhotos.length} new photo{pendingPhotos.length === 1 ? '' : 's'} will upload when you save.
                  </p>
                ) : null}
                <div className="photo-grid">
                  {formState.photoUrls.map((url) => (
                    <figure key={url}>
                      <button className="photo-preview-button" type="button" onClick={() => setLightboxPhoto(url)}>
                        <img src={url} alt={formState.title} />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateForm('photoUrls', formState.photoUrls.filter((photo) => photo !== url))}
                      >
                        Remove
                      </button>
                    </figure>
                  ))}
                  {pendingPhotos.map((photo) => (
                    <figure key={photo.id} className="photo-grid__pending">
                      <button className="photo-preview-button" type="button" onClick={() => setLightboxPhoto(photo.previewUrl)}>
                        <img src={photo.previewUrl} alt={photo.name} />
                      </button>
                      <button type="button" onClick={() => removePendingPhoto(photo.id)}>
                        Remove
                      </button>
                    </figure>
                  ))}
                </div>
              </div>

              <div className="coords">
                <span>Lat {selectedPlace.lat.toFixed(5)}</span>
                <span>Lng {selectedPlace.lng.toFixed(5)}</span>
                <span>{selectedPlace.sourceType === 'search' ? 'Search result' : 'Custom pin'}</span>
              </div>

              <div className="action-row">
                <button className="primary-action" type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : isExistingPlace(selectedPlace) ? 'Update place' : 'Save place'}
                </button>
                {isExistingPlace(selectedPlace) ? (
                  <button className="danger-action" type="button" onClick={handleDeletePlace} disabled={isSaving}>
                    Delete pin
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="empty-state">
              <p>Select a search result or click directly on the map to start a new place entry.</p>
            </div>
          )}
        </section>
      </aside>

      <main className="map-stage">
        <div ref={mapHostRef} className="map-host" />

        <section className="map-filters">
          <div className="panel-heading">
            <div>
              <p className="label">Pins filter</p>
              <h2>Find saved places</h2>
            </div>
            <span className="pill">{listFilteredPlaces.length} shown</span>
          </div>
          <div className="board-filters">
            <input
              value={listFilters.query}
              onChange={(event) => setListFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Filter by title, notes, or tags..."
            />
            <input
              type="date"
              value={listFilters.dateVisited}
              onChange={(event) => setListFilters((current) => ({ ...current, dateVisited: event.target.value }))}
            />
            <select
              value={listFilters.tag}
              onChange={(event) => setListFilters((current) => ({ ...current, tag: event.target.value }))}
            >
              <option value="">All badges</option>
              {TAG_OPTIONS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-tabs" aria-label="Visited filter">
            {[
              ['all', 'All'],
              ['visited', 'Visited'],
              ['planned', 'Planned'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={listFilters.visited === value ? 'filter-tab filter-tab--active' : 'filter-tab'}
                onClick={() => setListFilters((current) => ({ ...current, visited: value as ListFilters['visited'] }))}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={listFilters.favorite ? 'filter-tab filter-tab--active' : 'filter-tab'}
              onClick={() => setListFilters((current) => ({ ...current, favorite: !current.favorite }))}
            >
              Favorites
            </button>
          </div>
          <div className="category-chip-row" aria-label="Category filters">
            <button
              type="button"
              className={listFilters.category === 'all' ? 'category-chip category-chip--active' : 'category-chip'}
              onClick={() => setListFilters((current) => ({ ...current, category: 'all' }))}
            >
              All
            </button>
            {Object.entries(CATEGORY_META).map(([key, value]) => (
              <button
                key={key}
                type="button"
                className={listFilters.category === key ? 'category-chip category-chip--active' : 'category-chip'}
                onClick={() => setListFilters((current) => ({ ...current, category: key as MarkerIcon }))}
              >
                {value.emoji} {value.label}
              </button>
            ))}
          </div>
        </section>

        <section className="timeline-board">
          <div className="panel-heading">
            <div>
              <p className="label">Timeline</p>
              <h2>Recently visited</h2>
            </div>
            <span className="pill">{timelinePlaces.length} visits</span>
          </div>
          <div className="timeline-list">
            {timelineGroups.map((group) => (
              <section key={group.month} className="timeline-month">
                <h3>{group.month}</h3>
                <div className="timeline-month__places">
                  {group.places.map((place) => (
                    <button
                      key={`timeline-${place.id}`}
                      type="button"
                      className="timeline-card"
                      onClick={() => {
                        setSelectedPlace(place)
                        setFormState(toFormState(place))
                        clearPendingPhotos()
                      }}
                    >
                      {place.photoUrls[0] ? <img className="timeline-card__photo" src={place.photoUrls[0]} alt="" /> : null}
                      <span className="timeline-card__date">{formatDate(place.dateVisited)}</span>
                      <strong>
                        {place.favorite ? 'Hearted ' : ''}
                        {CATEGORY_META[place.category].emoji} {place.title}
                      </strong>
                      <p>{place.comment || 'No notes yet.'}</p>
                      <div className="badges-row">
                        {place.tags.map((tag) => (
                          <span key={`${place.id}-${tag}`} className="badge-pill">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!timelinePlaces.length ? (
              <div className="empty-state">
                <p>No visited places yet. Mark a pin as visited and add a date to build the timeline.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="pins-board">
          <div className="panel-heading">
            <div>
              <p className="label">Pins board</p>
              <h2>Saved places</h2>
            </div>
            <span className="pill">{listFilteredPlaces.length} shown</span>
          </div>

          <div className="pins-list">
            {listFilteredPlaces.map((place) => (
              <button
                key={place.id}
                type="button"
                className={
                  selectedPlace && isExistingPlace(selectedPlace) && selectedPlace.id === place.id
                    ? 'pin-card pin-card--active'
                    : 'pin-card'
                }
                onClick={() => {
                  setSelectedPlace(place)
                  setFormState(toFormState(place))
                  clearPendingPhotos()
                }}
              >
                {place.photoUrls[0] ? <img className="pin-card__photo" src={place.photoUrls[0]} alt="" /> : null}
                <div className="pin-card__header">
                  <strong>
                    {place.favorite ? 'Hearted ' : ''}
                    {CATEGORY_META[place.category].emoji} {place.title}
                  </strong>
                  <span className="pill">{CATEGORY_META[place.category].label}</span>
                </div>
                <p>{place.comment || 'No notes yet.'}</p>
                <div className="pin-card__meta">
                  <span>{place.visited ? 'Visited' : 'Planned'}</span>
                  <span>{formatDate(place.dateVisited)}</span>
                  <span>{place.rating > 0 ? `${place.rating}/5 stars` : 'Unrated'}</span>
                  {place.photoUrls.length ? (
                    <span>
                      {place.photoUrls.length} photo{place.photoUrls.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
                <div className="badges-row">
                  {place.tags.map((tag) => (
                    <span key={`${place.id}-${tag}`} className="badge-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
            {!listFilteredPlaces.length ? (
              <div className="empty-state">
                <p>No pins match the current filters.</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      {lightboxPhoto ? (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightboxPhoto(null)}>
          <button className="lightbox__close" type="button" onClick={() => setLightboxPhoto(null)}>
            Close
          </button>
          <img src={lightboxPhoto} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}

export default App
