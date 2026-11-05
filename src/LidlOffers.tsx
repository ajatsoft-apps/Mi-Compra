import { useEffect, useMemo, useState } from 'react'
import { supabase } from './data/supabaseClient'

type Props = { householdId: string; online: boolean; onBack: () => void }
type Snapshot = {
  id: string
  store_key: string
  store_name: string
  store_postal_code: string | null
  captured_on: string
  captured_at: string
  row_count: number
}
type Offer = {
  snapshot_id: string
  offer_id: string
  title: string
  brand: string | null
  category: string | null
  offer_type: string | null
  redemption_channel: string | null
  product_ids: string[]
  start_validity_date: string | null
  end_validity_date: string | null
  price_box: Record<string, unknown> | null
  image_url: string | null
}
const dateFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha indicada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateFormat.format(date)
}

function displayedPriceText(value: Record<string, unknown> | null): string {
  if (!value) return ''
  const parts = ['largePartNumeric', 'smallPartNumeric', 'largePartSymbol', 'smallPartSymbol']
    .map((key) => value[key])
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .map(String)
  return parts.join(' ')
}

export default function LidlOffers({ householdId, online, onBack }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [query, setQuery] = useState('')
  const [storeKey, setStoreKey] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadOffers() {
      setLoading(true)
      setError('')
      if (!online) {
        setError('Necesitas conexión para consultar las ofertas Lidl guardadas en Supabase.')
        setLoading(false)
        return
      }
      if (!supabase) {
        setError('La conexión con Supabase no está configurada.')
        setLoading(false)
        return
      }
      try {
        const { data: snapshotData, error: snapshotError } = await supabase
          .from('lidl_offer_snapshots')
          .select('id,store_key,store_name,store_postal_code,captured_on,captured_at,row_count')
          .eq('household_id', householdId)
          .order('captured_at', { ascending: false })
          .limit(30)
        if (snapshotError) throw snapshotError
        const latestByStore = new Map<string, Snapshot>()
        for (const row of (snapshotData ?? []) as Snapshot[]) {
          if (!latestByStore.has(row.store_key)) latestByStore.set(row.store_key, row)
        }
        const latest = [...latestByStore.values()]
        if (!active) return
        setSnapshots(latest)
        if (latest.length === 0) {
          setOffers([])
          setLoading(false)
          return
        }
        const { data: offerData, error: offerError } = await supabase
          .from('lidl_offer_observations')
          .select('snapshot_id,offer_id,title,brand,category,offer_type,redemption_channel,product_ids,start_validity_date,end_validity_date,price_box,image_url')
          .eq('household_id', householdId)
          .in('snapshot_id', latest.map((snapshot) => snapshot.id))
          .order('title', { ascending: true })
          .limit(500)
        if (offerError) throw offerError
        if (active) setOffers((offerData ?? []) as Offer[])
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las ofertas Lidl.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadOffers()
    return () => { active = false }
  }, [householdId, online])

  const snapshotsById = useMemo(() => new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])), [snapshots])
  const visibleOffers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es')
    const now = Date.now()
    return offers.filter((offer) => {
      if (storeKey !== 'all' && snapshotsById.get(offer.snapshot_id)?.store_key !== storeKey) return false
      if (offer.end_validity_date && Date.parse(offer.end_validity_date) < now) return false
      if (!term) return true
      return [offer.title, offer.brand, offer.category].some((value) => value?.toLocaleLowerCase('es').includes(term))
    })
  }, [offers, query, snapshotsById, storeKey])

  return (
    <section className="account-page market-prices-page" aria-label="Ofertas semanales Lidl">
      <div className="account-page-heading">
        <button className="back-to-list" type="button" onClick={onBack}>← Volver a la lista</button>
        <p className="eyebrow">OFERTAS SEMANALES · LIDL</p>
        <h1>Ofertas Lidl</h1>
        <p>Promociones obtenidas del feed Lidl Plus y guardadas para este hogar. No representan un catálogo completo ni garantizan existencias.</p>
      </div>

      {loading ? <p className="auth-note">Consultando las últimas ofertas…</p> : (
        <div className="market-price-status">
          <div><span>Tiendas consultadas</span><strong>{snapshots.length}</strong></div>
          <div><span>Ofertas vigentes o futuras</span><strong>{visibleOffers.length}</strong></div>
          <div><span>Captura más reciente</span><strong>{snapshots[0] ? formatDate(snapshots[0].captured_on) : 'Sin importar'}</strong></div>
        </div>
      )}

      {error && <p className="auth-feedback error" role="status">{error}</p>}

      {!loading && snapshots.length === 0 && !error && (
        <section className="account-page-card">
          <h2>Todavía no hay ofertas importadas</h2>
          <p className="auth-note">La base de datos ya está preparada. Falta configurar el hogar de destino en los secretos de GitHub y ejecutar la importación de ofertas Lidl.</p>
        </section>
      )}

      {snapshots.length > 0 && (
        <section className="account-page-card market-search-card">
          <label className="field-label" htmlFor="lidl-store-filter">Tienda</label>
          <select id="lidl-store-filter" className="text-input" value={storeKey} onChange={(event) => setStoreKey(event.target.value)}>
            <option value="all">Todas las tiendas</option>
            {snapshots.map((snapshot) => <option key={snapshot.store_key} value={snapshot.store_key}>{snapshot.store_name} · {snapshot.store_postal_code ?? snapshot.store_key}</option>)}
          </select>
          <label className="field-label" htmlFor="lidl-offer-search">Buscar oferta</label>
          <input id="lidl-offer-search" className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej. aceite, salmón, detergente…" />
        </section>
      )}

      {!loading && snapshots.length > 0 && visibleOffers.length === 0 && !error && (
        <p className="management-empty market-empty">No hay ofertas vigentes que coincidan con la búsqueda en las tiendas seleccionadas.</p>
      )}

      {visibleOffers.length > 0 && (
        <section className="account-page-card market-results-card">
          <div className="market-results-heading"><h2>Promociones</h2><span>{visibleOffers.length} ofertas</span></div>
          <ul className="market-results-list">
            {visibleOffers.map((offer) => {
              const snapshot = snapshotsById.get(offer.snapshot_id)
              const priceText = displayedPriceText(offer.price_box)
              return (
                <li className="market-result-row" key={offer.snapshot_id + ':' + offer.offer_id}>
                  {offer.image_url && <img src={offer.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 76, height: 76, objectFit: 'contain', borderRadius: 10 }} />}
                  <div className="market-result-main">
                    <strong>{offer.title}</strong>
                    <span>{[offer.brand, offer.category].filter(Boolean).join(' · ') || 'Oferta Lidl'}</span>
                    <small>{snapshot?.store_name ?? 'Tienda Lidl'} · {snapshot?.store_postal_code ?? snapshot?.store_key}</small>
                    <small>Vigencia: {formatDate(offer.start_validity_date)} – {formatDate(offer.end_validity_date)}</small>
                    {offer.redemption_channel && <small>Canal: {offer.redemption_channel === 'Store' ? 'Tienda física' : offer.redemption_channel === 'OnlineShop' ? 'Tienda online' : offer.redemption_channel}</small>}
                    {priceText && <small>Texto de precio mostrado por Lidl: {priceText}</small>}
                    {offer.offer_type && <small>Condiciones: {offer.offer_type}</small>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="market-price-disclaimer">
        <p>Los importes se conservan tal como los entrega Lidl. No se interpretan automáticamente como precio final cuando la promoción es porcentual, por varias unidades o tiene condiciones especiales. Los identificadores internos de Lidl no son EAN y no se usan para vincular productos.</p>
        <p>Fuente técnica: <a href="https://github.com/FaserF/ha-lidl" target="_blank" rel="noreferrer">ha-lidl</a> · Feed de ofertas Lidl Plus España. La fecha de captura no garantiza disponibilidad o stock en tienda.</p>
      </div>
    </section>
  )
}
