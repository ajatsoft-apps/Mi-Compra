import { useEffect, useState } from 'react'
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
  priceNumber: number | null
  unit: string
  imageUrl: string | null
  note: string
}

type Props = {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onSelect: (product: ProductSuggestion) => void
}

type SuggestionRow = {
  supermarket: string
  product_id: string
  product_name: string
  brand: string | null
  format: string | null
  category: string | null
  unit_price: number | string | null
  price_box: Record<string, unknown> | null
  image_url: string | null
  note: string | null
  store_name: string | null
  captured_at: string
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

function cleanFormat(value: string | null): string {
  return (value ?? '')
    .replace(/(\d+)\.(\d*?[1-9])0+(?=\s|$)/g, '$1.$2')
    .replace(/(\d+)\.0+(?=\s|$)/g, '$1')
}

function lidlPriceNumber(value: Record<string, unknown> | null): number | null {
  if (!value || !String(value.priceSymbol ?? '').includes('€')) return null
  const parsed = Number(value.largePartNumeric)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function lidlProductUnit(value: Record<string, unknown> | null): string {
  const symbol = String(value?.priceSymbol ?? '').toLocaleLowerCase('es')
  if (symbol.includes('/kg')) return 'kg'
  if (symbol.includes('/l')) return 'L'
  return 'ud.'
}

function formatLidlPrice(value: Record<string, unknown> | null): string {
  if (!value) return ''
  const current = lidlPriceNumber(value)
  if (current === null) {
    const message = String(value.discountMessage ?? '').trim()
    return message
  }

  const symbol = String(value.priceSymbol ?? '€')
  const amount = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(current)
  const currentText = symbol === '€' ? euro.format(current) : amount + ' ' + symbol
  const previous = Number(value.smallPartNumeric)
  const previousText = Number.isFinite(previous) && previous > current
    ? 'Antes ' + (symbol === '€' ? euro.format(previous) : new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(previous) + ' ' + symbol)
    : ''
  const discount = String(value.discountMessage ?? '').trim()
  return [currentText, previousText, discount].filter(Boolean).join(' · ')
}

export default function ProductAutocomplete({ value, disabled = false, onChange, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const term = value.trim()
    const client = supabase
    if (!client || term.length < 2) {
      setSuggestions([])
      setLoading(false)
      setError('')
      return
    }

    const db = client as NonNullable<typeof client>
    let active = true
    const timer = window.setTimeout(() => {
      void searchProducts(term)
    }, 220)

    async function searchProducts(searchTerm: string) {
      setLoading(true)
      setError('')
      try {
        const { data, error: queryError } = await db.rpc('search_shopping_product_suggestions', {
          p_query: searchTerm,
          p_zone: 'vlc1',
        })
        if (queryError) throw queryError
        if (!active) return

        const products = ((data ?? []) as SuggestionRow[])
          .filter((row) => row.supermarket === 'lidl' || row.supermarket === 'mercadona')
          .map((row) => {
            const isLidl = row.supermarket === 'lidl'
            const numericPrice = isLidl
              ? lidlPriceNumber(row.price_box)
              : row.unit_price === null ? null : Number(row.unit_price)
            const priceText = isLidl
              ? formatLidlPrice(row.price_box) || 'Oferta semanal'
              : numericPrice === null ? 'Precio no disponible' : euro.format(numericPrice)
            const format = cleanFormat(row.format)
            return {
              id: row.supermarket + ':' + row.product_id + ':' + (row.store_name ?? ''),
              supermarket: row.supermarket as Exclude<ShoppingStore, 'general'>,
              name: row.product_name,
              brand: row.brand ?? '',
              format,
              category: mapCategory(row.category),
              priceText,
              priceNumber: numericPrice,
              unit: isLidl ? lidlProductUnit(row.price_box) : 'ud.',
              imageUrl: row.image_url,
              note: row.note ?? [row.brand, format].filter(Boolean).join(' · '),
            }
          })
          .sort((a, b) => {
            if (a.priceNumber === null && b.priceNumber === null) return a.name.localeCompare(b.name, 'es')
            if (a.priceNumber === null) return 1
            if (b.priceNumber === null) return -1
            return a.priceNumber - b.priceNumber
          })
        setSuggestions(products)
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
      {!loading && !error && value.trim().length >= 2 && suggestions.length === 0 && (
        <span className="autocomplete-status">No hay coincidencias. Puedes añadirlo como producto genérico.</span>
      )}
      {suggestions.length > 0 && (
        <div className="product-suggestions" id="product-suggestions" role="listbox" aria-label="Productos disponibles">
          {suggestions.map((product) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className={'product-suggestion ' + product.supermarket}
              key={product.id}
              onClick={() => onSelect(product)}
              disabled={disabled}
            >
              {product.imageUrl
                ? <img className="suggestion-image" src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                : <span className="suggestion-image suggestion-placeholder">🛒</span>}
              <span className="suggestion-copy">
                <strong>{product.name}</strong>
                <small>{[product.brand, product.format].filter(Boolean).join(' · ')}</small>
              </span>
              <strong className="suggestion-price">{product.priceText}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
