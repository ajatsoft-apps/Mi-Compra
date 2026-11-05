import { useEffect, useMemo, useState } from 'react'
import { supabase } from './data/supabaseClient'
import type { ShoppingItem } from './domain/shopping'

type Props = {
  items: ShoppingItem[]
  householdId: string
  online: boolean
  onBack: () => void
}

type Snapshot = { id: string; captured_at: string; row_count: number }
type CatalogRow = { id: string; name: string; barcode: string | null }
type Observation = {
  sku: string
  ean: string
  product_name: string
  unit_price: number | string
  reference_price: number | string | null
  reference_format: string | null
  is_discounted: boolean
}
type ResultRow = {
  item: ShoppingItem
  catalogName: string | null
  observation: Observation | null
  reason: string
  estimatedTotal: number | null
}

const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

function normalizeUnit(value: string): string {
  const unit = value.trim().toLocaleLowerCase('es').replace(/\s+/g, '')
  if (['ud', 'ud.', 'unidad', 'unidades'].includes(unit)) return 'unit'
  if (['pack', 'packs'].includes(unit)) return 'pack'
  if (['caja', 'cajas'].includes(unit)) return 'box'
  return unit
}

function referenceUnit(value: string | null): 'kg' | 'l' | 'unit' | null {
  if (!value) return null
  const normalized = value.toLocaleLowerCase('es').replace(/\s+/g, '')
  if (/\/kg|€\/kg|eur\/kg/.test(normalized)) return 'kg'
  if (/\/l(?:itro)?s?$|€\/l|eur\/l/.test(normalized)) return 'l'
  if (/\/ud\.?|\/unidad/.test(normalized)) return 'unit'
  return null
}

function estimateLineTotal(item: ShoppingItem, observation: Observation): number | null {
  const quantity = Number(item.quantity)
  const packPrice = Number(observation.unit_price)
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(packPrice) || packPrice < 0) return null

  const itemUnit = normalizeUnit(item.unit)
  if (['unit', 'pack', 'box'].includes(itemUnit)) return quantity * packPrice

  const referencePrice = observation.reference_price === null ? null : Number(observation.reference_price)
  const marketUnit = referenceUnit(observation.reference_format)
  if (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice < 0) return null

  if (itemUnit === 'kg' && marketUnit === 'kg') return quantity * referencePrice
  if (itemUnit === 'g' && marketUnit === 'kg') return quantity / 1000 * referencePrice
  if (itemUnit === 'l' && marketUnit === 'l') return quantity * referencePrice
  if (itemUnit === 'ml' && marketUnit === 'l') return quantity / 1000 * referencePrice
  if (itemUnit === 'unit' && marketUnit === 'unit') return quantity * referencePrice
  return null
}

function formatReference(observation: Observation): string {
  if (observation.reference_price === null || !observation.reference_format) return ''
  return `${Number(observation.reference_price).toLocaleString('es-ES', { maximumFractionDigits: 3 })} ${observation.reference_format}`
}

export default function BasketOptimizer({ items, householdId, online, onBack }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [rows, setRows] = useState<ResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pendingItems = useMemo(() => items.filter((item) => !item.completed && !item.deletedAt), [items])

  useEffect(() => {
    let active = true
    async function loadComparison() {
      setLoading(true)
      setError('')
      setRows([])
      if (!online) {
        setError('Necesitas conexión para consultar los precios actuales. La lista sigue disponible sin conexión.')
        setLoading(false)
        return
      }
      if (!supabase) {
        setError('La conexión con Supabase no está configurada.')
        setLoading(false)
        return
      }
      try {
        const { data: latest, error: snapshotError } = await supabase
          .from('market_price_snapshots')
          .select('id,captured_at,row_count')
          .eq('source', 'opencesta')
          .eq('chain', 'mercadona')
          .eq('zone', 'vlc1')
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (snapshotError) throw snapshotError
        if (!latest) throw new Error('Todavía no hay una captura de precios disponible.')
        if (!active) return
        const currentSnapshot = latest as Snapshot
        setSnapshot(currentSnapshot)

        const catalogIds = [...new Set(pendingItems.map((item) => item.catalogProductId).filter((id): id is string => Boolean(id)))]
        if (catalogIds.length === 0) {
          setRows(pendingItems.map((item) => ({ item, catalogName: null, observation: null, reason: 'Vincula este artículo a un producto del catálogo familiar para buscar su EAN exacto.', estimatedTotal: null })))
          setLoading(false)
          return
        }

        const { data: catalogData, error: catalogError } = await supabase
          .from('household_products')
          .select('id,name,barcode')
          .eq('household_id', householdId)
          .in('id', catalogIds)
          .is('archived_at', null)
        if (catalogError) throw catalogError
        const catalog = (catalogData ?? []) as CatalogRow[]
        const byId = new Map(catalog.map((product) => [product.id, product]))
        const barcodes = [...new Set(catalog.map((product) => product.barcode?.trim()).filter((barcode): barcode is string => Boolean(barcode)))]
        let observations: Observation[] = []
        if (barcodes.length > 0) {
          const { data, error: pricesError } = await supabase
            .from('market_price_observations')
            .select('sku,ean,product_name,unit_price,reference_price,reference_format,is_discounted')
            .eq('snapshot_id', currentSnapshot.id)
            .in('ean', barcodes)
          if (pricesError) throw pricesError
          observations = (data ?? []) as Observation[]
        }
        const byEan = new Map<string, Observation[]>()
        for (const observation of observations) {
          const matches = byEan.get(observation.ean) ?? []
          matches.push(observation)
          byEan.set(observation.ean, matches)
        }

        const nextRows = pendingItems.map((item): ResultRow => {
          const product = item.catalogProductId ? byId.get(item.catalogProductId) : undefined
          if (!product) return { item, catalogName: null, observation: null, reason: 'No está vinculado a un producto activo del catálogo.', estimatedTotal: null }
          if (!product.barcode?.trim()) return { item, catalogName: product.name, observation: null, reason: 'El producto del catálogo no tiene EAN; no se buscará por parecido del nombre.', estimatedTotal: null }
          const matches = byEan.get(product.barcode.trim()) ?? []
          if (matches.length === 0) return { item, catalogName: product.name, observation: null, reason: 'No hay coincidencia exacta por EAN en la última captura.', estimatedTotal: null }
          if (matches.length > 1) return { item, catalogName: product.name, observation: null, reason: 'El EAN aparece más de una vez en la fuente; se evita elegir un precio ambiguo.', estimatedTotal: null }
          const observation = matches[0]
          return {
            item,
            catalogName: product.name,
            observation,
            reason: '',
            estimatedTotal: estimateLineTotal(item, observation),
          }
        })
        if (active) setRows(nextRows)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'No se pudo calcular la cesta.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadComparison()
    return () => { active = false }
  }, [householdId, online, pendingItems])

  const comparableRows = rows.filter((row) => row.estimatedTotal !== null)
  const partialTotal = comparableRows.reduce((sum, row) => sum + (row.estimatedTotal ?? 0), 0)

  return (
    <section className="account-page optimizer-page" aria-label="Optimizador de la cesta">
      <div className="account-page-heading">
        <button className="back-to-list" type="button" onClick={onBack}>← Volver a la lista</button>
        <p className="eyebrow">FASE 8 · OPTIMIZADOR</p>
        <h1>Calcula tu cesta</h1>
        <p>Relaciona los artículos de tu lista con el precio de Mercadona usando únicamente el EAN exacto del catálogo familiar.</p>
      </div>

      {!online && <p className="auth-feedback error" role="status">Sin conexión: el cálculo necesita consultar la última captura de precios.</p>}
      {error && <p className="auth-feedback error" role="status">{error}</p>}
      {loading && <p className="auth-note">Consultando productos y precios…</p>}

      {!loading && snapshot && (
        <div className="market-price-status optimizer-status">
          <div><span>Captura utilizada</span><strong>{new Date(snapshot.captured_at + 'T00:00:00').toLocaleDateString('es-ES')}</strong></div>
          <div><span>Artículos pendientes</span><strong>{pendingItems.length}</strong></div>
          <div><span>Con coste calculable</span><strong>{comparableRows.length}</strong></div>
        </div>
      )}

      {!loading && pendingItems.length === 0 && <p className="management-empty">No hay artículos pendientes en la lista.</p>}

      {!loading && rows.length > 0 && (
        <section className="account-page-card optimizer-results">
          <div className="optimizer-total">
            <div><span>Subtotal calculable de Mercadona</span><strong>{euro.format(partialTotal)}</strong></div>
            <small>No es el total de la cesta si quedan artículos sin coincidencia o sin unidad compatible.</small>
          </div>
          <ul className="market-results-list">
            {rows.map((row) => (
              <li className="market-result-row" key={row.item.id}>
                <div className="market-result-main">
                  <strong>{row.item.name} · {row.item.quantity} {row.item.unit}</strong>
                  <span>{row.observation ? row.observation.product_name : row.catalogName ?? 'Sin referencia de catálogo'}</span>
                  {row.observation && <small>EAN exacto · {row.observation.is_discounted ? 'Precio rebajado según la fuente' : 'Precio de la captura'}</small>}
                  {!row.observation && <small>{row.reason}</small>}
                  {row.observation && row.estimatedTotal === null && <small>No se puede calcular el importe: la unidad de la lista no coincide con la unidad de referencia disponible.</small>}
                  {row.observation && formatReference(row.observation) && <small>Precio de referencia: {formatReference(row.observation)}</small>}
                </div>
                <div className="market-result-price">
                  {row.observation && <strong>{euro.format(Number(row.observation.unit_price))}</strong>}
                  {row.estimatedTotal !== null && <span>En tu lista: {euro.format(row.estimatedTotal)}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="market-price-disclaimer">
        <p>Primera versión: solo consulta Mercadona (OpenCesta, zona vlc1). No compara todavía cadenas distintas. Las coincidencias son exclusivamente por EAN exacto; no se usan nombres parecidos ni sustitutos automáticos. El subtotal suma solo las líneas cuya unidad permite un cálculo fiable.</p>
        <p>Fuente: <a href="https://github.com/ruvelro/opencesta" target="_blank" rel="noreferrer">OpenCesta</a> · Licencia ODbL 1.0. La fecha corresponde a la captura, no garantiza disponibilidad en tienda.</p>
      </div>
    </section>
  )
}
