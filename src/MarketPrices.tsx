import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './data/supabaseClient'

type Snapshot = {
  id: string
  captured_at: string
  imported_at: string
  row_count: number
  source_url: string
  source_license: string
}

type MarketPrice = {
  sku: string
  product_name: string
  brand: string | null
  ean: string | null
  origin: string | null
  packaging: string | null
  legal_name: string | null
  category: string
  subcategory: string
  unit_price: number
  reference_price: number | null
  reference_format: string | null
  is_discounted: boolean
  product_url: string | null
}

type Props = { onBack: () => void }

const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

function formatDate(value: string): string {
  return new Date(value + 'T00:00:00').toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function MarketPrices({ onBack }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MarketPrice[]>([])
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadLatestSnapshot() {
      if (!supabase) {
        if (active) {
          setError('La conexión con Supabase no está configurada.')
          setLoadingSnapshot(false)
        }
        return
      }
      const { data, error: loadError } = await supabase
        .from('market_price_snapshots')
        .select('id,captured_at,imported_at,row_count,source_url,source_license')
        .eq('source', 'opencesta')
        .eq('chain', 'mercadona')
        .eq('zone', 'vlc1')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!active) return
      if (loadError) setError('No se pudo consultar el catálogo de precios: ' + loadError.message)
      else if (data) setSnapshot(data as Snapshot)
      else setError('Todavía no se ha importado el primer catálogo. La importación automática se activará al configurar el acceso seguro de GitHub.')
      setLoadingSnapshot(false)
    }
    void loadLatestSnapshot()
    return () => { active = false }
  }, [])

  async function searchProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = query.trim()
    if (!supabase || !snapshot) return
    if (term.length < 2) {
      setError('Escribe al menos dos caracteres para buscar.')
      return
    }
    setSearching(true)
    setError('')
    setResults([])
    setSearched(true)
    const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%'
    const { data, error: searchError } = await supabase
      .from('market_price_observations')
      .select('sku,product_name,brand,ean,origin,packaging,legal_name,category,subcategory,unit_price,reference_price,reference_format,is_discounted,product_url')
      .eq('snapshot_id', snapshot.id)
      .ilike('product_name', pattern)
      .order('product_name', { ascending: true })
      .limit(80)
    if (searchError) setError('No se pudo completar la búsqueda: ' + searchError.message)
    else setResults((data ?? []) as MarketPrice[])
    setSearching(false)
  }

  return (
    <section className="account-page market-prices-page" aria-label="Precios de supermercados">
      <div className="account-page-heading">
        <button className="back-to-list" type="button" onClick={onBack}>← Volver a la lista</button>
        <p className="eyebrow">PRECIOS DE REFERENCIA</p>
        <h1>Precios de Mercadona</h1>
        <p>Busca productos y consulta el precio de la última captura disponible para la zona de datos vlc1.</p>
      </div>

      {loadingSnapshot ? <p className="auth-note">Consultando la última actualización…</p> : snapshot && (
        <div className="market-price-status">
          <div><span>Última captura</span><strong>{formatDate(snapshot.captured_at)}</strong></div>
          <div><span>Productos del snapshot</span><strong>{snapshot.row_count.toLocaleString('es-ES')}</strong></div>
          <div><span>Zona</span><strong>vlc1 · zona del feed</strong></div>
        </div>
      )}

      {error && <p className="auth-feedback error" role="status">{error}</p>}

      <section className="account-page-card market-search-card">
        <form className="market-search-form" onSubmit={searchProducts}>
          <label className="field-label" htmlFor="market-product-search">¿Qué producto quieres consultar?</label>
          <div className="market-search-row">
            <input id="market-product-search" className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej. leche, aceite de oliva, detergente…" minLength={2} />
            <button className="add-button" type="submit" disabled={!snapshot || searching || query.trim().length < 2}>{searching ? 'Buscando…' : 'Buscar precios'}</button>
          </div>
        </form>
      </section>

      {searched && !searching && !error && results.length === 0 && <p className="management-empty market-empty">No se han encontrado productos con ese nombre en este snapshot.</p>}

      {results.length > 0 && (
        <section className="account-page-card market-results-card">
          <div className="market-results-heading"><h2>Resultados</h2><span>{results.length} productos</span></div>
          <ul className="market-results-list">
            {results.map((product) => (
              <li key={product.sku} className="market-result-row">
                <div className="market-result-main">
                  <strong>{product.product_name}</strong>
                  <span>{[product.brand, product.category, product.subcategory].filter(Boolean).join(' · ')}</span>
                  {product.ean && <small>EAN: {product.ean}</small>}
                  {product.origin && <small>Origen: {product.origin}</small>}
                  {product.packaging && <small>Envase: {product.packaging}</small>}
                  {product.is_discounted && <small className="market-price-reduced">Precio rebajado según la fuente</small>}
                  {product.product_url && <a href={product.product_url} target="_blank" rel="noreferrer">Ver producto en Mercadona</a>}
                </div>
                <div className="market-result-price">
                  <strong>{euro.format(Number(product.unit_price))}</strong>
                  {product.reference_price !== null && product.reference_format && <span>{Number(product.reference_price).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} {product.reference_format}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="market-price-disclaimer">
        <p>Los datos proceden del dataset diario de OpenCesta. La zona vlc1 es una zona logística del catálogo online y no garantiza que cada producto esté disponible en todas las tiendas físicas de Castellón. El catálogo general puede no incluir EAN ni marca para todas las referencias.</p>
        <p>Fuente: <a href="https://github.com/ruvelro/opencesta" target="_blank" rel="noreferrer">OpenCesta</a> · Licencia de la base de datos: <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0</a>. Los precios no sustituyen la comprobación en el establecimiento.</p>
      </div>
    </section>
  )
}
