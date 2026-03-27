import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PlaceRecord, SavePlaceInput, Workspace, WorkspaceContext } from '../types'

type InitializeOptions = {
  slug: string
  shareKey: string
}

type Backend = {
  initialize: (options: InitializeOptions) => Promise<WorkspaceContext>
  listPlaces: (workspaceId: string) => Promise<PlaceRecord[]>
  savePlace: (input: SavePlaceInput) => Promise<PlaceRecord>
  deletePlace: (workspaceId: string, placeId: string) => Promise<void>
  uploadPhoto: (workspaceId: string, file: File) => Promise<string>
  subscribe: (workspaceId: string, onPlaces: (places: PlaceRecord[]) => void) => () => void
}

type DatabasePlaceRow = {
  id: string
  workspace_id: string
  title: string
  lat: number
  lng: number
  category: PlaceRecord['category']
  marker_icon: PlaceRecord['markerIcon']
  visited: boolean
  date_visited: string | null
  source_type: PlaceRecord['sourceType']
  created_at: string
  updated_at: string
}

type DatabaseEntryRow = {
  place_id: string
  comment: string | null
  rating: number | null
  tags: string[] | null
  photo_paths: string[] | null
}

type LocalStore = {
  workspace: Workspace
  places: PlaceRecord[]
}

const STORAGE_BUCKET = 'place-photos'

export function createBackend(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (url && anonKey) {
    return new SupabaseBackend(url, anonKey)
  }

  return new LocalBackend()
}

class LocalBackend implements Backend {
  private storageKey = ''

  async initialize({ slug, shareKey }: InitializeOptions) {
    this.storageKey = `sg-shared-map:${slug}:${shareKey}`
    const store = this.readStore(slug, shareKey)
    this.writeStore(store)

    return {
      workspace: store.workspace,
      mode: 'local' as const,
    }
  }

  async listPlaces() {
    return this.readStore().places.sort(sortByRecent)
  }

  async savePlace(input: SavePlaceInput) {
    const store = this.readStore()
    const timestamp = new Date().toISOString()
    const existing = store.places.find((place) => place.id === input.placeId)
    const nextPlace: PlaceRecord = existing
      ? {
          ...existing,
          ...normalizeInput(input),
          updatedAt: timestamp,
        }
      : {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          ...normalizeInput(input),
          createdAt: timestamp,
          updatedAt: timestamp,
        }

    const nextPlaces = existing
      ? store.places.map((place) => (place.id === existing.id ? nextPlace : place))
      : [nextPlace, ...store.places]

    this.writeStore({ ...store, places: nextPlaces })
    window.dispatchEvent(new StorageEvent('storage', { key: this.storageKey }))
    return nextPlace
  }

  async uploadPhoto(_workspaceId: string, file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Unable to persist the selected image in local mode.'))
      reader.readAsDataURL(file)
    })
  }

  async deletePlace(_workspaceId: string, placeId: string) {
    const store = this.readStore()
    const nextPlaces = store.places.filter((place) => place.id !== placeId)
    this.writeStore({ ...store, places: nextPlaces })
    window.dispatchEvent(new StorageEvent('storage', { key: this.storageKey }))
  }

  subscribe(_workspaceId: string, onPlaces: (places: PlaceRecord[]) => void) {
    const listener = () => {
      onPlaces(this.readStore().places.sort(sortByRecent))
    }

    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }

  private readStore(slug?: string, shareKey?: string): LocalStore {
    const resolvedKey = this.storageKey || `sg-shared-map:${slug}:${shareKey}`
    const raw = window.localStorage.getItem(resolvedKey)

    if (!raw) {
      return {
        workspace: {
          id: crypto.randomUUID(),
          slug: slug ?? 'singapore-shared',
          shareKey: shareKey ?? 'local-share',
          createdAt: new Date().toISOString(),
        },
        places: [],
      }
    }

    return JSON.parse(raw) as LocalStore
  }

  private writeStore(store: LocalStore) {
    window.localStorage.setItem(this.storageKey, JSON.stringify(store))
  }
}

class SupabaseBackend implements Backend {
  private client: SupabaseClient

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }

  async initialize({ slug, shareKey }: InitializeOptions) {
    const auth = await this.client.auth.getSession()

    if (!auth.data.session) {
      const result = await this.client.auth.signInAnonymously()
      if (result.error) {
        throw new Error(`Anonymous sign-in failed: ${result.error.message}`)
      }
    }

    const joinResult = await this.client.rpc('join_workspace', {
      p_slug: slug,
      p_share_key: shareKey,
    })

    if (joinResult.error) {
      throw new Error(`Workspace access failed: ${joinResult.error.message}`)
    }

    const workspace = normalizeWorkspace(joinResult.data)

    return {
      workspace,
      mode: 'supabase' as const,
    }
  }

  async listPlaces(workspaceId: string) {
    const [{ data: placeRows, error: placeError }, { data: entryRows, error: entryError }] = await Promise.all([
      this.client
        .from('places')
        .select('id, workspace_id, title, lat, lng, category, marker_icon, visited, date_visited, source_type, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false }),
      this.client.from('entries').select('place_id, comment, rating, tags, photo_paths'),
    ])

    if (placeError) {
      throw new Error(`Failed to load places: ${placeError.message}`)
    }

    if (entryError) {
      throw new Error(`Failed to load entries: ${entryError.message}`)
    }

    return mergePlacesAndEntries(placeRows ?? [], entryRows ?? [])
  }

  async savePlace(input: SavePlaceInput) {
    const payload = {
      workspace_id: input.workspaceId,
      title: input.title,
      lat: input.lat,
      lng: input.lng,
      category: input.category,
      marker_icon: input.markerIcon,
      visited: input.visited,
      date_visited: input.dateVisited,
      source_type: input.sourceType,
    }

    const { data: savedPlace, error: placeError } = input.placeId
      ? await this.client
          .from('places')
          .update(payload)
          .eq('id', input.placeId)
          .select('id, workspace_id, title, lat, lng, category, marker_icon, visited, date_visited, source_type, created_at, updated_at')
          .single()
      : await this.client
          .from('places')
          .insert({ ...payload })
          .select('id, workspace_id, title, lat, lng, category, marker_icon, visited, date_visited, source_type, created_at, updated_at')
          .single()

    if (placeError || !savedPlace) {
      throw new Error(`Failed to save the place: ${placeError?.message ?? 'Unknown error'}`)
    }

    const { error: entryError } = await this.client.from('entries').upsert({
      place_id: savedPlace.id,
      comment: input.comment,
      rating: input.rating || null,
      tags: input.tags,
      photo_paths: input.photoUrls,
      updated_at: new Date().toISOString(),
    })

    if (entryError) {
      throw new Error(`Place saved, but notes failed to update: ${entryError.message}`)
    }

    return {
      ...mapPlaceRow(savedPlace),
      comment: input.comment,
      rating: input.rating,
      tags: input.tags,
      photoUrls: input.photoUrls,
    }
  }

  async uploadPhoto(workspaceId: string, file: File) {
    const filename = `${workspaceId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`
    const upload = await this.client.storage.from(STORAGE_BUCKET).upload(filename, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })

    if (upload.error) {
      throw new Error(`Photo upload failed: ${upload.error.message}`)
    }

    const { data } = this.client.storage.from(STORAGE_BUCKET).getPublicUrl(filename)
    return data.publicUrl
  }

  async deletePlace(_workspaceId: string, placeId: string) {
    const { error } = await this.client.from('places').delete().eq('id', placeId)

    if (error) {
      throw new Error(`Failed to delete the place: ${error.message}`)
    }
  }

  subscribe(workspaceId: string, onPlaces: (places: PlaceRecord[]) => void) {
    const channel = this.client
      .channel(`workspace:${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'places', filter: `workspace_id=eq.${workspaceId}` },
        async () => {
          onPlaces(await this.listPlaces(workspaceId))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entries' },
        async () => {
          onPlaces(await this.listPlaces(workspaceId))
        },
      )
      .subscribe()

    return () => {
      void this.client.removeChannel(channel)
    }
  }
}

function mergePlacesAndEntries(placeRows: DatabasePlaceRow[], entryRows: DatabaseEntryRow[]) {
  const entryMap = new Map(entryRows.map((row) => [row.place_id, row]))

  return placeRows.map((row) => {
    const entry = entryMap.get(row.id)
    return {
      ...mapPlaceRow(row),
      comment: entry?.comment ?? '',
      rating: entry?.rating ?? 0,
      tags: entry?.tags ?? [],
      photoUrls: entry?.photo_paths ?? [],
    }
  })
}

function normalizeWorkspace(data: unknown): Workspace {
  const row = data as {
    id: string
    slug: string
    share_key: string
    edit_pin_hash: string | null
    created_at: string
  }

  return {
    id: row.id,
    slug: row.slug,
    shareKey: row.share_key,
    editPinHash: row.edit_pin_hash,
    createdAt: row.created_at,
  }
}

function mapPlaceRow(row: DatabasePlaceRow): PlaceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    markerIcon: row.marker_icon,
    visited: row.visited,
    dateVisited: row.date_visited,
    sourceType: row.source_type,
    comment: '',
    rating: 0,
    tags: [],
    photoUrls: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeInput(input: SavePlaceInput) {
  return {
    title: input.title,
    lat: input.lat,
    lng: input.lng,
    category: input.category,
    markerIcon: input.markerIcon,
    visited: input.visited,
    dateVisited: input.dateVisited,
    sourceType: input.sourceType,
    comment: input.comment,
    rating: input.rating,
    tags: input.tags,
    photoUrls: input.photoUrls,
  }
}

function sortByRecent(left: PlaceRecord, right: PlaceRecord) {
  return right.updatedAt.localeCompare(left.updatedAt)
}

function sanitizeFileName(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-')
}
