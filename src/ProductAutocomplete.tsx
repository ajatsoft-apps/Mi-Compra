import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { supabase } from './data/supabaseClient'
import type { Category, ShoppingStore } from './domain/shopping'

export type ProductSuggestion = {
  id: string
  supermarket: Exclude<ShoppingStore, 'general'>
  name: string
  brand: string
  format: string
  category: Category
  priceText: string
  imageUrl: string | null
  note: string
}

type Props = {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onSelect: (product: ProductSuggestion) => void
}

type MercadonaRow = {
  sku: string
  product_name: string
  brand: string | null
  unit_price: number | string
  unit_size: number | string | null
  size_format: string | null
  is_pack: boolean
  category: string
  thumbnail_url: string | null
}

type LidlSnapshot = { id: string; store_key: string; store_name: string; captured_at: string }
type LidlOffer = {
  snapshot_id: string
  offer_id: string
  title: string
  brand: string | null
  category: string | null
  end_validity_date: string | null
  price_box: Record<string, unknown> | null
  image_url: string | null
}

const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

function mapCategory(value: string | null | undefined): Category {
  const normalized = (value ?? '').toLocaleLowerCase('es')
  if (normalized.includes('fruta') || normalized.includes('verdura')) return 'Fruta y verdura'
  if (normalized.includes('láct') || normalized.includes('lact') || normalized.includes('leche') || normalized.includes('queso')) return 'Lácteos'
  if (normalized.includes('bebida') || normalized.includes('agua') || normalized.includes('refresco')) return 'Bebidas'
  if (normalized.includes('hogar') || normalized.includes('limpieza')) return 'Hogar'
  if (normalized.includes('despensa') || normalized.includes('alimentación') || normalized.includes('alimentacion') || normalized.includes('conserva')) return 'Despensa'
  return 'Otros'
}

function formatLidlPrice(value: Record<string, unknown> | null): string {
  if (!value) return ''
  return ['largePartNumeric', 'smallPartNumeric', 'largePartSymbol', 'smallPartSymbol']
    .map((key) => value[key])
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .map(String)
    .join(' ')
}

export default function ProductAutocomplete({ value, disabled = false, onChange, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const snapshotCache = useRef<Promise<{ mercadonaSnapshotId: string | null; lidlSnapshots: LidlSnapshot[] }> | null>(null)

  useEffect(() => {
    const term = value.trim()
    const client = supabase
    if (!client || term.length < 2) {
      setSuggestions([])
      setLoading(false)
      setError('')
      return
    }

    let active = true
    const timer = window.setTimeout(() => {
      void searchProducts(term)
    }, 220)

    async function searchProducts(searchTerm: string) {
      setLoading(true)
      setError('')
      const pattern = '%' + searchTerm.replace(/[\\%_]/g, '\\$&') + '%'
      try {
        if (!snapshotCache.current) {
          snapshotCache.current = Promise.all([
            client.from('market_price_snapshots')
              .select('id')
              .eq('source', 'opencesta')
              .eq('chain', 'mercadona')
              .eq('zone', 'vlc1')
              .order('captured_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            client.from('lidl_offer_snapshots')
              .select('id,store_key,store_name,captured_at')
              .order('captured_at', { ascending: false })
              .limit(40),
          ]).then(([mercadonaSnapshot, lidlSnapshotResult]) => {
            if (mercadonaSnapshot.error) throw mercadonaSnapshot.error
            if (lidlSnapshotResult.error) throw lidlSnapshotResult.error
            const latestByStore = new Map<string, LidlSnapshot>()
            for (const snapshot of (lidlSnapshotResult.data ?? []) as LidlSnapshot[]) {
              if (!latestByStore.has(snapshot.store_key)) latestByStore.set(snapshot.store_key, snapshot)
            }
            return {
              mercadonaSnapshotId: mercadonaSnapshot.data?.id ?? null,
              lidlSnapshots: [...latestByStore.values()].filter((snapshot) =>
                Date.parse(snapshot.captured_at) >= Date.now() - 14 * 24 * 60 * 60 * 1000),
            }
          }).catch((cause: unknown) => {
            snapshotCache.current = null
            throw cause
          })
        }
        const { mercadonaSnapshotId, lidlSnapshots } = await snapshotCache.current
        const mercadonaPromise = mercadonaSnapshotId
          ? client.from('market_price_observations')
              .select('sku,product_name,brand,unit_price,unit_size,size_format,is_pack,category,thumbnail_url')
              .eq('snapshot_id', mercadonaSnapshotId)
              .ilike('product_name', pattern)
              .order('product_name', { ascending: true })
              .limit(8)
          : Promise.resolve({ data: [], error: null })

        const lidlPromise = lidlSnapshots.length > 0
          ? client.from('lidl_offer_observations')
              .select('snapshot_id,offer_id,title,brand,category,end_validity_date,price_box,image_url')
              .in('snapshot_id', lidlSnapshots.map((snapshot) => snapshot.id))
              .ilike('title', pattern)
              .order('title', { ascending: true })
              .limit(8)
          : Promise.resolve({ data: [], error: null })

        const [mercadonaResult, lidlResult] = await Promise.all([mercadonaPromise, lidlPromise])
        if (mercadonaResult.error) throw mercadonaResult.error
        if (lidlResult.error) throw lidlResult.error
        if (!active) return

        const mercadonaProducts = ((mercadonaResult.data ?? []) as MercadonaRow[]).map((row) => {
          const size = row.unit_size !== null && row.size_format
            ? Number(row.unit_size).toLocaleString('es-ES', { maximumFractionDigits: 3 }) + ' ' + row.size_format
            : ''
          const format = [row.is_pack ? 'Pack' : '', size].filter(Boolean).join(' · ')
          return {
            id: 'mercadona:' + row.sku,
            supermarket: 'mercadona' as const,
            name: row.product_name,
            brand: row.brand ?? '',
            format,
            category: mapCategory(row.category),
            priceText: euro.format(Number(row.unit_price)),
            imageUrl: row.thumbnail_url,
            note: [row.brand, format].filter(Boolean).join(' · '),
          }
        })

        const snapshotById = new Map(lidlSnapshots.map((snapshot) => [snapshot.id, snapshot]))
        const now = Date.now()
        const lidlProducts = ((lidlResult.data ?? []) as LidlOffer[])
          .filter((offer) => !offer.end_validity_date || Date.parse(offer.end_validity_date) >= now)
          .map((offer) => {
            const snapshot = snapshotById.get(offer.snapshot_id)
            const price = formatLidlPrice(offer.price_box)
            return {
              id: 'lidl:' + offer.snapshot_id + ':' + offer.offer_id,
              supermarket: 'lidl' as const,
              name: offer.title,
              brand: offer.brand ?? '',
              format: [snapshot?.store_name, offer.category].filter(Boolean).join(' · '),
              category: mapCategory(offer.category),
              priceText: price || 'Oferta semanal',
              imageUrl: offer.image_url,
              note: [offer.brand, offer.category, snapshot?.store_name].filter(Boolean).join(' · '),
            }
          })

        setSuggestions([...mercadonaProducts, ...lidlProducts])
      } catch (cause) {
        if (active) {
          setSuggestions([])
          setError(cause instanceof Error ? cause.message : 'No se pudieron consultar los productos disponibles.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [value])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && suggestions.length > 0) {
      event.preventDefault()
      onSelect(suggestions[0])
    }
  }

  return (
    <div className="product-autocomplete">
      <input
        id="product-name"
        className="text-input product-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ej. leche, jamón serrano, café…"
        maxLength={120}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls="product-suggestions"
        disabled={disabled}
        required
      />
      {loading && <span className="autocomplete-status">Buscando productos…</span>}
      {error && <span className="autocomplete-status autocomplete-error">{error}</span>}
      {suggestions.length > 0 && (
        <div className="product-suggestions" id="product-suggestions" role="listbox" aria-label="Productos disponibles">
          {suggestions.map((product) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="product-suggestion"
              key={product.id}
              onClick={() => onSelect(product)}
              disabled={disabled}
            >
              <span className={'supermarket-mark ' + product.supermarket}>{product.supermarket === 'lidl' ? 'LIDL' : 'M'}</span>
              {product.imageUrl
                ? <img className="suggestion-image" src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                : <span className="suggestion-image suggestion-placeholder">🛒</span>}
              <span className="suggestion-copy">
                <strong>{product.name}</strong>
                <small>{[product.brand, product.format, product.supermarket === 'lidl' ? 'Lidl' : 'Mercadona'].filter(Boolean).join(' · ')}</small>
              </span>
              <strong className="suggestion-price">{product.priceText}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
