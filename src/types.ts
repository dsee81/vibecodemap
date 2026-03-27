export type MarkerIcon = 'food' | 'attraction' | 'museum' | 'cafe' | 'custom'
export type PlaceSourceType = 'search' | 'custom'

export type Workspace = {
  id: string
  slug: string
  shareKey: string
  editPinHash?: string | null
  createdAt: string
}

export type WorkspaceContext = {
  workspace: Workspace
  mode: 'supabase' | 'local'
}

export type PlaceRecord = {
  id: string
  workspaceId: string
  title: string
  lat: number
  lng: number
  category: MarkerIcon
  markerIcon: MarkerIcon
  visited: boolean
  dateVisited: string | null
  sourceType: PlaceSourceType
  comment: string
  rating: number
  tags: string[]
  photoUrls: string[]
  createdAt: string
  updatedAt: string
}

export type DraftPlace = Omit<
  PlaceRecord,
  'id' | 'workspaceId' | 'comment' | 'rating' | 'photoUrls' | 'createdAt' | 'updatedAt'
>

export type SearchPlace = {
  title: string
  lat: number
  lng: number
  neighbourhood: string
  category: MarkerIcon
}

export type SavePlaceInput = {
  workspaceId: string
  placeId?: string
  title: string
  lat: number
  lng: number
  category: MarkerIcon
  markerIcon: MarkerIcon
  visited: boolean
  dateVisited: string | null
  sourceType: PlaceSourceType
  comment: string
  rating: number
  tags: string[]
  photoUrls: string[]
}
