import { useEffect, useMemo, useState } from 'react'
import { supabase } from './data/supabaseClient'

type Props = { online: boolean; onBack: () => void; onAddToBasket: (name: string, unitPrice: number | null, unit: string) => void }
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
type OfferTab = 'food' | 'bazaar'
const dateFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const euroCurrency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const foodTerms = /fruta|verdura|patata|tomate|lechuga|lim[oó]n|naranja|mandarina|aguacate|manzana|pera|pl[aá]tano|carne|pollo|cerdo|ternera|vacuno|cordero|pavo|hamburguesa|salchicha|butifarra|pescado|salm[oó]n|merluza|bacalao|marisco|gamba|langostino|mejill[oó]n|pan|baguette|boll[oó]|pastel|tarta|galleta|barquillo|leche|queso|yogur|nata|mantequilla|huevo|arroz|pasta|harina|az[uú]car|aceite|vinagre|legumbre|lenteja|garbanzo|alubia|conserva|at[uú]n|sardina|cereal|cacao|caf[eé]|infusi[oó]n|zumo|agua|refresco|cerveza|vino|chocolate|helado|pizza|croqueta|empanada|l[aá]cteo|alimentaci[oó]n|congelado|embutido|jam[oó]n|chorizo|salami|snack|aperitivo|frutos secos|ma[ií]z|seta|champi[nñ][oó]n|calabac[ií]n|berenjena|pimiento|cebolla|ajo|br[oó]coli|coliflor|zanahoria|pepino|espinaca|uva|fresa|mel[oó]n|sand[ií]a|kiwi|pi[nñ]a|melocot[oó]n|ciruela|cereza|mango|papaya|coco|d[aá]til|higo|panader[ií]a|despensa/i

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha indicada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateFormat.format(date)
}

function asPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function isFoodOffer(offer: Offer): boolean {
  const searchable = [offer.title, offer.brand, offer.category].filter(Boolean).join(' ')
  return foodTerms.test(searchable)
}

function displayedPrice(value: Record<string, unknown> | null): { offer: number | null; regular: number | null; symbol: string; discount: string } {
  return {
    offer: asPrice(value?.largePartNumeric),
    regular: asPrice(value?.smallPartNumeric),
    symbol: typeof value?.priceSymbol === 'string' ? value.priceSymbol : '€',
    discount: typeof value?.discountMessage === 'string' ? value.discountMessage : '',
  }
}

export default function LidlOffers({ online, onBack, onAddToBasket }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<OfferTab>('food')
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
          .order('captured_at', { ascending: false })
          .limit(1)
        if (snapshotError) throw snapshotError
        const latest = (snapshotData ?? []) as Snapshot[]
        if (!active) return
        setSnapshot(latest[0] ?? null)
        if (!latest[0]) {
          setOffers([])
          setLoading(false)
          return
        }
        const { data: offerData, error: offerError } = await supabase
          .from('lidl_offer_observations')
          .select('snapshot_id,offer_id,title,brand,category,offer_type,redemption_channel,product_ids,start_validity_date,end_validity_date,price_box,image_url')
          .eq('snapshot_id', latest[0].id)
          .order('title', { ascending: true })
          .limit(500)
        if (offerError) throw offerError
        if (active) {
          const unique = new Map<string, Offer>()
          for (const offer of (offerData ?? []) as Offer[]) {
            const previous = unique.get(offer.offer_id)
            if (!previous || (!previous.price_box && offer.price_box)) unique.set(offer.offer_id, offer)
          }
          setOffers([...unique.values()])
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las ofertas Lidl.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadOffers()
    return () => { active = false }
  }, [online])

  const visibleOffers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es')
    const now = Date.now()
    return offers.filter((offer) => {
      if (offer.end_validity_date && Date.parse(offer.end_validity_date) < now) return false
      if ((tab === 'food') !== isFoodOffer(offer)) return false
      if (!term) return true
      return [offer.title, offer.brand, offer.category].some((value) => value?.toLocaleLowerCase('es').includes(term))
    })
  }, [offers, query, tab])

  return (
    <section className="account-page market-prices-page" aria-label="Ofertas semanales Lidl">
      <div className="account-page-heading">
        <button className="back-to-list" type="button" onClick={onBack}>← Volver a la lista</button>
        <p className="eyebrow">OFERTAS SEMANALES · LIDL</p>
        <h1>Ofertas Lidl</h1>
        <p>Ofertas generales de Lidl España. Se muestran una sola vez, sin repetirlas por cada tienda.</p>
      </div>

      {!loading && (
        <div className="market-price-status">
          <div><span>Ofertas vigentes</span><strong>{offers.filter((offer) => !offer.end_validity_date || Date.parse(offer.end_validity_date) >= Date.now()).length}</strong></div>
          <div><span>Alimentación</span><strong>{offers.filter(isFoodOffer).length}</strong></div>
          <div><span>Bazar</span><strong>{offers.filter((offer) => !isFoodOffer(offer)).length}</strong></div>
        </div>
      )}

      {loading && <p className="auth-note">Consultando las últimas ofertas…</p>}
      {error && <p className="auth-feedback error" role="status">{error}</p>}
      {!loading && !snapshot && !error && (
        <section className="account-page-card">
          <h2>Todavía no hay ofertas importadas</h2>
          <p className="auth-note">Las ofertas se mostrarán aquí cuando termine la primera importación.</p>
        </section>
      )}

      {snapshot && (
        <section className="account-page-card market-search-card">
          <div className="lidl-offer-tabs" role="tablist" aria-label="Tipo de ofertas">
            <button type="button" role="tab" aria-selected={tab === 'food'} className={tab === 'food' ? 'active' : ''} onClick={() => setTab('food')}>🥬 Alimentación <span>{offers.filter(isFoodOffer).length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'bazaar'} className={tab === 'bazaar' ? 'active' : ''} onClick={() => setTab('bazaar')}>🧰 Bazar <span>{offers.filter((offer) => !isFoodOffer(offer)).length}</span></button>
          </div>
          <label className="field-label" htmlFor="lidl-offer-search">Buscar en {tab === 'food' ? 'alimentación' : 'bazar'}</label>
          <input id="lidl-offer-search" className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej. aceite, salmón, detergente…" />
          <small className="lidl-offer-capture">Última captura: {formatDate(snapshot.captured_on)} · {snapshot.store_name}</small>
        </section>
      )}

      {!loading && snapshot && visibleOffers.length === 0 && !error && (
        <p className="management-empty market-empty">No hay ofertas {tab === 'food' ? 'de alimentación' : 'de bazar'} que coincidan con la búsqueda.</p>
      )}

      {visibleOffers.length > 0 && (
        <section className="account-page-card market-results-card">
          <div className="market-results-heading"><h2>{tab === 'food' ? 'Alimentación' : 'Bazar'}</h2><span>{visibleOffers.length} ofertas</span></div>
          <ul className="market-results-list">
            {visibleOffers.map((offer) => {
              const price = displayedPrice(offer.price_box)
              const currentPrice = price.offer
              return (
                <li className="market-result-row lidl-offer-row" key={offer.offer_id}>
                  {offer.image_url && <img src={offer.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  <div className="market-result-main">
                    <strong>{offer.title}</strong>
                    <span>{[offer.brand, offer.category && offer.category !== 'Store' ? offer.category : null].filter(Boolean).join(' · ') || 'Oferta Lidl'}</span>
                    <small>Vigencia: {formatDate(offer.start_validity_date)} – {formatDate(offer.end_validity_date)}</small>
                    {price.offer != null && (
                      <div className="lidl-offer-prices">
                        <strong>{euroCurrency.format(price.offer)}{price.symbol.startsWith('€/') ? ' / ' + price.symbol.slice(2) : ''}</strong>
                        {price.regular != null && price.regular > price.offer && <del>Antes {euroCurrency.format(price.regular)}{price.symbol.startsWith('€/') ? ' / ' + price.symbol.slice(2) : ''}</del>}
                        {price.discount && <span>{price.discount}</span>}
                      </div>
                    )}
                    {offer.offer_type && <small>Condiciones: {offer.offer_type}</small>}
                    <button className="add-button lidl-offer-add" type="button" onClick={() => onAddToBasket(offer.title, currentPrice, price.symbol.startsWith('€/') ? price.symbol.slice(2) : 'ud.')}>＋ Añadir a cesta</button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="market-price-disclaimer">
        <p>Se muestra el precio de oferta y, cuando Lidl lo proporciona, el precio anterior. Si la oferta no incluye un importe numérico, no se inventa ni se calcula.</p>
        <p>La misma promoción se muestra una sola vez, no una vez por cada tienda. La fecha de captura no garantiza disponibilidad o stock.</p>
      </div>
    </section>
  )
}
