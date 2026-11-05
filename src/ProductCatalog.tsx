import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './data/supabaseClient'
import type { Category } from './domain/shopping'

type Product = {
  id: string
  name: string
  barcode: string | null
  brand: string
  format_quantity: number | null
  format_unit: string
  category: Category
  notes: string
}
type Preference = {
  product_id: string
  preferred_brand: string
  preferred_format: string
  allow_substitutes: boolean
  notes: string
}
type Purchase = {
  id: string
  product_name_snapshot: string
  brand_snapshot: string
  format_quantity: number | null
  format_unit: string
  quantity: number
  unit_price: number | null
  total_price: number | null
  store_name: string
  purchased_at: string
}
type Equivalence = { id: string; product_id: string; equivalent_product_id: string; equivalence_type: string; notes: string }

type Props = {
  householdId: string
  userId: string
  online: boolean
  onBack: () => void
  onAddToList: (product: Product) => void
}

const categories: Category[] = ['Fruta y verdura', 'Lácteos', 'Despensa', 'Bebidas', 'Hogar', 'Otros']
const blankForm = { name: '', brand: '', barcode: '', format_quantity: '', format_unit: 'ud.', category: 'Otros' as Category, notes: '' }

export default function ProductCatalog({ householdId, userId, online, onBack, onAddToList }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [preferences, setPreferences] = useState<Record<string, Preference>>({})
  const [equivalences, setEquivalences] = useState<Equivalence[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [activeTab, setActiveTab] = useState<'catalog' | 'history'>('catalog')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [equivalentProduct, setEquivalentProduct] = useState('')
  const [equivalenceType, setEquivalenceType] = useState<'same_product' | 'accepted_substitute'>('accepted_substitute')
  const [preferenceBrand, setPreferenceBrand] = useState('')
  const [preferenceFormat, setPreferenceFormat] = useState('')
  const [allowSubstitutes, setAllowSubstitutes] = useState(true)
  const [purchaseQuantity, setPurchaseQuantity] = useState('1')
  const [purchaseUnitPrice, setPurchaseUnitPrice] = useState('')
  const [purchaseTotal, setPurchaseTotal] = useState('')
  const [purchaseStore, setPurchaseStore] = useState('')
  const [purchaseTarget, setPurchaseTarget] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!supabase || !online) return
    const [productsResult, preferencesResult, equivalencesResult, purchasesResult] = await Promise.all([
      supabase.from('household_products').select('id,name,barcode,brand,format_quantity,format_unit,category,notes').eq('household_id', householdId).is('archived_at', null).order('name'),
      supabase.from('household_product_preferences').select('product_id,preferred_brand,preferred_format,allow_substitutes,notes').eq('household_id', householdId),
      supabase.from('household_product_equivalences').select('id,product_id,equivalent_product_id,equivalence_type,notes').eq('household_id', householdId),
      supabase.from('purchase_history').select('id,product_name_snapshot,brand_snapshot,format_quantity,format_unit,quantity,unit_price,total_price,store_name,purchased_at').eq('household_id', householdId).order('purchased_at', { ascending: false }).limit(100),
    ])
    if (productsResult.error) throw productsResult.error
    if (preferencesResult.error) throw preferencesResult.error
    if (equivalencesResult.error) throw equivalencesResult.error
    if (purchasesResult.error) throw purchasesResult.error
    const nextProducts = (productsResult.data ?? []) as Product[]
    setProducts(nextProducts)
    setPreferences(Object.fromEntries((preferencesResult.data ?? []).map((p) => [p.product_id, p as Preference])))
    setEquivalences((equivalencesResult.data ?? []) as Equivalence[])
    setPurchases((purchasesResult.data ?? []) as Purchase[])
  }, [householdId, online])

  useEffect(() => {
    if (!online) return
    let active = true
    setBusy(true)
    setError('')
    refresh().catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.')
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [refresh, online])

  useEffect(() => {
    if (!supabase || !online) return
    const channel = supabase.channel('household-catalog-' + householdId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_products', filter: 'household_id=eq.' + householdId }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_product_preferences', filter: 'household_id=eq.' + householdId }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_product_equivalences', filter: 'household_id=eq.' + householdId }, () => { void refresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_history', filter: 'household_id=eq.' + householdId }, () => { void refresh() })
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [householdId, online, refresh])

  const filteredProducts = useMemo(() => products.filter((p) => [p.name, p.brand, p.barcode ?? ''].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())), [products, search])

  function resetForm() { setForm(blankForm); setEditingId(null) }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !online || !form.name.trim()) return
    setBusy(true); setError(''); setMessage('')
    const payload = {
      name: form.name.trim(), brand: form.brand.trim(), barcode: form.barcode.trim() || null,
      format_quantity: form.format_quantity.trim() ? Number(form.format_quantity) : null,
      format_unit: form.format_unit.trim() || 'ud.', category: form.category, notes: form.notes.trim(),
    }
    if (payload.format_quantity !== null && (!Number.isFinite(payload.format_quantity) || payload.format_quantity <= 0)) {
      setError('El formato debe ser una cantidad mayor que cero.'); setBusy(false); return
    }
    const result = editingId
      ? await supabase.from('household_products').update(payload).eq('id', editingId).eq('household_id', householdId)
      : await supabase.from('household_products').insert({ ...payload, household_id: householdId, created_by: userId })
    if (result.error) setError(result.error.message)
    else { resetForm(); setMessage(editingId ? 'Producto actualizado.' : 'Producto añadido al catálogo.'); await refresh() }
    setBusy(false)
  }

  function editProduct(product: Product) {
    setEditingId(product.id)
    setForm({ name: product.name, brand: product.brand, barcode: product.barcode ?? '', format_quantity: product.format_quantity?.toString() ?? '', format_unit: product.format_unit, category: product.category, notes: product.notes })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function archiveProduct(product: Product) {
    if (!supabase || !window.confirm('¿Archivar «' + product.name + '»? No aparecerá al añadir productos, pero se conservarán sus compras anteriores.')) return
    setBusy(true); setError('')
    const { error: updateError } = await supabase.from('household_products').update({ archived_at: new Date().toISOString() }).eq('id', product.id).eq('household_id', householdId)
    if (updateError) setError(updateError.message)
    else { if (editingId === product.id) resetForm(); setMessage('Producto archivado.'); await refresh() }
    setBusy(false)
  }

  async function savePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedProduct) return
    setBusy(true); setError('')
    const { error: saveError } = await supabase.from('household_product_preferences').upsert({
      household_id: householdId, product_id: selectedProduct, preferred_brand: preferenceBrand.trim(),
      preferred_format: preferenceFormat.trim(), allow_substitutes: allowSubstitutes, updated_by: userId,
    }, { onConflict: 'household_id,product_id' })
    if (saveError) setError(saveError.message)
    else { setMessage('Preferencias familiares guardadas.'); await refresh() }
    setBusy(false)
  }

  async function addEquivalence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedProduct || !equivalentProduct || selectedProduct === equivalentProduct) return
    setBusy(true); setError('')
    const { error: saveError } = await supabase.from('household_product_equivalences').upsert({
      household_id: householdId, product_id: selectedProduct, equivalent_product_id: equivalentProduct,
      equivalence_type: equivalenceType, created_by: userId,
    }, { onConflict: 'household_id,product_id,equivalent_product_id' })
    if (saveError) setError(saveError.message)
    else { setEquivalentProduct(''); setMessage('Equivalencia guardada.'); await refresh() }
    setBusy(false)
  }

  async function deleteEquivalence(id: string) {
    if (!supabase) return
    const { error: deleteError } = await supabase.from('household_product_equivalences').delete().eq('id', id).eq('household_id', householdId)
    if (deleteError) setError(deleteError.message)
    else await refresh()
  }

  async function recordPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !purchaseTarget) return
    const qty = Number(purchaseQuantity), unitPrice = purchaseUnitPrice.trim() ? Number(purchaseUnitPrice) : null
    const total = purchaseTotal.trim() ? Number(purchaseTotal) : unitPrice === null ? null : Number((qty * unitPrice).toFixed(2))
    if (!Number.isFinite(qty) || qty <= 0 || (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) || (total !== null && (!Number.isFinite(total) || total < 0))) {
      setError('Revisa la cantidad y los precios introducidos.'); return
    }
    setBusy(true); setError('')
    const { error: saveError } = await supabase.from('purchase_history').insert({
      household_id: householdId, product_id: purchaseTarget.id, product_name_snapshot: purchaseTarget.name,
      brand_snapshot: purchaseTarget.brand, format_quantity: purchaseTarget.format_quantity,
      format_unit: purchaseTarget.format_unit, quantity: qty, unit_price: unitPrice, total_price: total,
      store_name: purchaseStore.trim(), created_by: userId,
    })
    if (saveError) setError(saveError.message)
    else { setPurchaseTarget(null); setPurchaseQuantity('1'); setPurchaseUnitPrice(''); setPurchaseTotal(''); setMessage('Compra registrada.'); await refresh() }
    setBusy(false)
  }

  const chosenPreference = selectedProduct ? preferences[selectedProduct] : undefined

  return (
    <section className="account-page catalog-page" aria-label="Catálogo de productos">
      <div className="account-page-heading">
        <button className="back-to-list" type="button" onClick={onBack}>← Volver a la lista</button>
        <p className="eyebrow">PRODUCTOS DE CASA</p>
        <h1>Catálogo familiar</h1>
        <p>Guarda productos habituales, formatos, preferencias y sustitutos aceptados por el hogar.</p>
      </div>
      {!online && <p className="auth-feedback error" role="status">El catálogo compartido necesita conexión. La lista de compra sigue disponible sin conexión.</p>}
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {message && <p className="auth-feedback" role="status">{message}</p>}
      <div className="catalog-tabs">
        <button type="button" className={activeTab === 'catalog' ? 'filter-tab active' : 'filter-tab'} onClick={() => setActiveTab('catalog')}>Productos ({products.length})</button>
        <button type="button" className={activeTab === 'history' ? 'filter-tab active' : 'filter-tab'} onClick={() => setActiveTab('history')}>Historial ({purchases.length})</button>
      </div>
      {activeTab === 'catalog' ? (
        <>
          <div className="account-page-grid catalog-grid">
            <section className="account-page-card">
              <p className="field-label">{editingId ? 'EDITAR PRODUCTO' : 'NUEVO PRODUCTO'}</p>
              <form className="auth-form" onSubmit={saveProduct}>
                <label className="field-label" htmlFor="catalog-name">Nombre</label>
                <input id="catalog-name" className="text-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required placeholder="Ej. Leche semidesnatada" />
                <label className="field-label" htmlFor="catalog-brand">Marca</label>
                <input id="catalog-brand" className="text-input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} maxLength={80} placeholder="Marca habitual" />
                <div className="quantity-row">
                  <div><label className="field-label" htmlFor="catalog-format">Contenido del envase</label><input id="catalog-format" className="text-input" type="number" min="0.001" step="any" value={form.format_quantity} onChange={(e) => setForm({ ...form, format_quantity: e.target.value })} placeholder="1" /></div>
                  <div><label className="field-label" htmlFor="catalog-unit">Unidad</label><select id="catalog-unit" className="text-input" value={form.format_unit} onChange={(e) => setForm({ ...form, format_unit: e.target.value })}><option>ud.</option><option>kg</option><option>g</option><option>L</option><option>ml</option><option>pack</option><option>caja</option></select></div>
                </div>
                <label className="field-label" htmlFor="catalog-barcode">Código de barras (opcional)</label>
                <input id="catalog-barcode" className="text-input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} maxLength={32} inputMode="numeric" placeholder="EAN / GTIN" />
                <label className="field-label" htmlFor="catalog-category">Categoría</label>
                <select id="catalog-category" className="text-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
                <label className="field-label" htmlFor="catalog-notes">Notas</label>
                <input id="catalog-notes" className="text-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} placeholder="Detalles del producto" />
                <button className="add-button" type="submit" disabled={busy || !online || !form.name.trim()}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Añadir al catálogo'}</button>
                {editingId && <button className="secondary-action" type="button" onClick={resetForm}>Cancelar edición</button>}
              </form>
            </section>
            <section className="account-page-card">
              <p className="field-label">CATÁLOGO DEL HOGAR</p>
              <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre, marca o código…" aria-label="Buscar productos del catálogo" />
              {busy && products.length === 0 ? <p className="management-empty">Cargando catálogo…</p> : filteredProducts.length === 0 ? <p className="management-empty">Todavía no hay productos. Añade los habituales de casa.</p> : (
                <ul className="management-list">
                  {filteredProducts.map((product) => (
                    <li className="management-row catalog-product-row" key={product.id}>
                      <div className="management-person"><strong>{product.name}</strong><span>{[product.brand, product.format_quantity ? product.format_quantity + ' ' + product.format_unit : '', product.barcode ?? ''].filter(Boolean).join(' · ') || product.category}</span></div>
                      <div className="management-actions catalog-actions">
                        <button type="button" className="management-link" onClick={() => onAddToList(product)}>Añadir</button>
                        <button type="button" className="management-link" onClick={() => { setSelectedProduct(product.id); const p = preferences[product.id]; setPreferenceBrand(p?.preferred_brand ?? product.brand); setPreferenceFormat(p?.preferred_format ?? (product.format_quantity ? product.format_quantity + ' ' + product.format_unit : '')); setAllowSubstitutes(p?.allow_substitutes ?? true) }}>Preferencias</button>
                        <button type="button" className="management-link" onClick={() => editProduct(product)}>Editar</button>
                        <button type="button" className="management-remove" onClick={() => void archiveProduct(product)}>Archivar</button>
                        <button type="button" className="management-link" onClick={() => { setPurchaseTarget(product); setPurchaseQuantity('1') }}>Compra</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {selectedProduct && (
            <section className="account-page-card catalog-detail-card">
              <div className="management-subheading"><h3>Preferencias y equivalencias</h3><button className="management-link" type="button" onClick={() => setSelectedProduct('')}>Cerrar</button></div>
              <p className="auth-note">Producto: {products.find((p) => p.id === selectedProduct)?.name}</p>
              <form className="catalog-preference-form" onSubmit={savePreference}>
                <label className="field-label">Marca preferida</label><input className="text-input" value={preferenceBrand} onChange={(e) => setPreferenceBrand(e.target.value)} maxLength={80} />
                <label className="field-label">Formato preferido</label><input className="text-input" value={preferenceFormat} onChange={(e) => setPreferenceFormat(e.target.value)} maxLength={80} placeholder="Ej. 1 L, paquete de 6" />
                <label className="catalog-checkbox"><input type="checkbox" checked={allowSubstitutes} onChange={(e) => setAllowSubstitutes(e.target.checked)} /> Aceptar productos sustitutos</label>
                <button className="add-button" type="submit" disabled={busy}>Guardar preferencias</button>
              </form>
              <form className="catalog-equivalence-form" onSubmit={addEquivalence}>
                <label className="field-label" htmlFor="catalog-equivalent">Añadir equivalente o sustituto aceptado</label>
                <select id="catalog-equivalent" className="text-input" value={equivalentProduct} onChange={(e) => setEquivalentProduct(e.target.value)}><option value="">Seleccionar producto…</option>{products.filter((p) => p.id !== selectedProduct && !equivalences.some((eq) => eq.product_id === selectedProduct && eq.equivalent_product_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.brand}</option>)}</select>
                <select className="text-input" value={equivalenceType} onChange={(e) => setEquivalenceType(e.target.value as typeof equivalenceType)}><option value="accepted_substitute">Sustituto aceptado</option><option value="same_product">Mismo producto</option></select>
                <button className="secondary-action" type="submit" disabled={busy || !equivalentProduct}>Guardar equivalencia</button>
              </form>
              {equivalences.filter((eq) => eq.product_id === selectedProduct).map((eq) => <div className="catalog-equivalence-row" key={eq.id}><span>{products.find((p) => p.id === eq.equivalent_product_id)?.name ?? 'Producto'} · {eq.equivalence_type === 'same_product' ? 'Mismo producto' : 'Sustituto aceptado'}</span><button className="management-remove" type="button" onClick={() => void deleteEquivalence(eq.id)}>Quitar</button></div>)}
            </section>
          )}
        </>
      ) : (
        <section className="account-page-card catalog-history-card">
          <p className="field-label">ÚLTIMAS COMPRAS</p>
          {purchases.length === 0 ? <p className="management-empty">Aún no hay compras registradas. Puedes registrar una desde cualquier producto del catálogo.</p> : <div className="catalog-history-list">{purchases.map((purchase) => <div className="catalog-history-row" key={purchase.id}><div><strong>{purchase.product_name_snapshot}</strong><span>{[purchase.brand_snapshot, purchase.format_quantity ? purchase.format_quantity + ' ' + purchase.format_unit : '', purchase.store_name].filter(Boolean).join(' · ')}</span><small>{new Date(purchase.purchased_at).toLocaleDateString()} · {purchase.quantity} ud. {purchase.total_price !== null ? '· ' + Number(purchase.total_price).toFixed(2) + ' €' : ''}</small></div></div>)}</div>}
        </section>
      )}
      {purchaseTarget && (
        <div className="catalog-modal-backdrop" role="presentation">
          <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-title">
            <div className="auth-heading"><h2 id="purchase-title">Registrar compra</h2><button className="panel-close" type="button" onClick={() => setPurchaseTarget(null)} aria-label="Cerrar">×</button></div>
            <p className="auth-note">{purchaseTarget.name} · {purchaseTarget.brand}</p>
            <form className="auth-form" onSubmit={recordPurchase}>
              <label className="field-label">Cantidad de envases</label><input className="text-input" type="number" min="0.001" step="any" value={purchaseQuantity} onChange={(e) => setPurchaseQuantity(e.target.value)} required />
              <label className="field-label">Precio por envase (€)</label><input className="text-input" type="number" min="0" step="0.0001" value={purchaseUnitPrice} onChange={(e) => setPurchaseUnitPrice(e.target.value)} placeholder="Opcional" />
              <label className="field-label">Total pagado (€)</label><input className="text-input" type="number" min="0" step="0.01" value={purchaseTotal} onChange={(e) => setPurchaseTotal(e.target.value)} placeholder="Se calcula si indicas precio por envase" />
              <label className="field-label">Establecimiento</label><input className="text-input" value={purchaseStore} onChange={(e) => setPurchaseStore(e.target.value)} maxLength={120} placeholder="Supermercado" />
              <button className="add-button" type="submit" disabled={busy}>Guardar compra</button>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
