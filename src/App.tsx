import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { loadLocalWorkspace, saveLocalItems } from './data/localDatabase'
import type { Category, ShoppingItem } from './domain/shopping'

type Filter = 'Pendientes' | 'Todo' | 'Comprados'

const categories: Category[] = ['Fruta y verdura', 'Lácteos', 'Despensa', 'Bebidas', 'Hogar', 'Otros']
const categoryIcons: Record<Category, string> = {
  'Fruta y verdura': '🥑',
  Lácteos: '🥛',
  Despensa: '🥫',
  Bebidas: '🧃',
  Hogar: '🧽',
  Otros: '🛒',
}

function App() {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [householdName, setHouseholdName] = useState('Mi casa')
  const [householdId, setHouseholdId] = useState('household-local')
  const [listId, setListId] = useState('shopping-list-default')
  const [storageError, setStorageError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('ud.')
  const [category, setCategory] = useState<Category>('Otros')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<Filter>('Pendientes')

  useEffect(() => {
    let active = true
    loadLocalWorkspace().then((workspace) => {
      if (!active) return
      setItems(workspace.items)
      setHouseholdName(workspace.household.name)
      setHouseholdId(workspace.household.id)
      setListId(workspace.list.id)
      setIsReady(true)
    }).catch(() => {
      if (active) {
        setStorageError('No se pudo recuperar el almacenamiento local. Tus cambios podrían no conservarse.')
        setIsReady(true)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (isReady) void saveLocalItems(listId, items).catch(() => setStorageError('No se pudo guardar la lista en este dispositivo. Comprueba el espacio disponible del navegador.'))
  }, [items, isReady, listId])

  const pendingCount = items.filter((item) => !item.completed).length
  const completedCount = items.length - pendingCount
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (filter === 'Pendientes') return !item.completed
      if (filter === 'Comprados') return item.completed
      return true
    })
    return filtered.sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt)
  }, [items, filter])

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    const parsedQuantity = Number(quantity)
    if (!cleanName || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return

    const newItem: ShoppingItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanName,
      quantity: parsedQuantity,
      unit: unit.trim() || 'ud.',
      category,
      note: note.trim(),
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      householdId,
      listId,
    }
    setItems((current) => [newItem, ...current])
    setName('')
    setQuantity('1')
    setUnit('ud.')
    setNote('')
  }

  function toggleItem(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, completed: !item.completed } : item))
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  function clearCompleted() {
    setItems((current) => current.filter((item) => !item.completed))
    setFilter('Pendientes')
  }

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Mi Compra, inicio">
            <span className="brand-mark" aria-hidden="true">✓</span>
            <span><strong>Mi Compra</strong><small>La compra de casa, en orden</small></span>
          </a>
          <div className="household-pill"><span className="online-dot" /> {householdName} <span className="pill-avatar">⌂</span></div>
        </header>

        <section className="welcome">
          <div>
            <p className="eyebrow">TU LISTA DE LA COMPRA</p>
            <h1>Que no se te<br /><span>olvide nada.</span></h1>
            <p className="welcome-copy">Añade lo que falta en casa y tenlo todo a mano cuando vayas al supermercado.</p>
          </div>
          <div className="basket-art" aria-hidden="true"><span>🥬</span><span>🥖</span><span>🍊</span><span>🥛</span></div>
        </section>

        <section className="summary-grid" aria-label="Resumen de la lista">
          <div className="summary-card summary-main">
            <span className="summary-icon">📝</span>
            <div><strong>{pendingCount}</strong><span>por comprar</span></div>
          </div>
          <div className="summary-card">
            <span className="summary-icon muted">✓</span>
            <div><strong>{completedCount}</strong><span>en el carrito</span></div>
          </div>
        </section>

        <div className="content-grid">
          <section className="panel add-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">AÑADIR A LA LISTA</p><h2>¿Qué hace falta?</h2></div>
              <span className="heading-plus">＋</span>
            </div>
            <form onSubmit={addItem}>
              <label className="field-label" htmlFor="product-name">Producto</label>
              <input id="product-name" className="text-input product-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Leche semidesnatada" maxLength={90} required />
              <div className="quantity-row">
                <div className="quantity-field">
                  <label className="field-label" htmlFor="product-quantity">Cantidad</label>
                  <input id="product-quantity" className="text-input" type="number" min="0.1" step="0.1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                </div>
                <div className="unit-field">
                  <label className="field-label" htmlFor="product-unit">Unidad</label>
                  <select id="product-unit" className="text-input" value={unit} onChange={(event) => setUnit(event.target.value)}>
                    <option>ud.</option><option>kg</option><option>g</option><option>L</option><option>ml</option><option>pack</option><option>caja</option>
                  </select>
                </div>
              </div>
              <label className="field-label category-label">Categoría</label>
              <div className="category-options">
                {categories.map((option) => (
                  <button className={category === option ? 'category-chip selected' : 'category-chip'} type="button" key={option} onClick={() => setCategory(option)}>
                    <span>{categoryIcons[option]}</span>{option}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="product-note">Nota <span className="optional">(opcional)</span></label>
              <input id="product-note" className="text-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Marca, formato o algún detalle..." maxLength={140} />
              <button className="add-button" type="submit" disabled={!isReady || Boolean(storageError) || !name.trim() || Number(quantity) <= 0}>Añadir a la lista <span>＋</span></button>
            </form>
          </section>

          <section className="panel list-panel">
            <div className="list-heading">
              <div><p className="eyebrow">COMPRA FAMILIAR</p><h2>Lista de casa <span className="item-count">{pendingCount}</span></h2></div>
              <span className="list-icon">🛒</span>
            </div>
            <div className="filter-tabs" role="tablist" aria-label="Filtrar productos">
              {(['Pendientes', 'Todo', 'Comprados'] as Filter[]).map((option) => (
                <button key={option} type="button" role="tab" aria-selected={filter === option} className={filter === option ? 'filter-tab active' : 'filter-tab'} onClick={() => setFilter(option)}>
                  {option}{option === 'Pendientes' && <span>{pendingCount}</span>}
                </button>
              ))}
            </div>

            {!isReady ? (
              <div className="empty-state"><span className="empty-illustration">⌛</span><strong>Preparando tu lista…</strong><p>Estamos recuperando los productos guardados en este dispositivo.</p></div>
            ) : visibleItems.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration">{filter === 'Comprados' ? '🧺' : '🌱'}</span>
                <strong>{filter === 'Comprados' ? 'Aún no has marcado productos' : filter === 'Todo' ? 'Tu lista está vacía' : '¡Todo al día!'}</strong>
                <p>{filter === 'Comprados' ? 'Cuando marques algo como comprado, aparecerá aquí.' : 'Añade el primer producto desde el formulario.'}</p>
              </div>
            ) : (
              <ul className="shopping-list">
                {visibleItems.map((item) => (
                  <li className={item.completed ? 'shopping-item completed' : 'shopping-item'} key={item.id}>
                    <button className="check-button" type="button" onClick={() => toggleItem(item.id)} aria-label={item.completed ? `Marcar ${item.name} como pendiente` : `Marcar ${item.name} como comprado`} aria-pressed={item.completed}>{item.completed ? '✓' : ''}</button>
                    <span className="item-category-icon" aria-hidden="true">{categoryIcons[item.category]}</span>
                    <div className="item-details">
                      <strong>{item.name}</strong>
                      <span>{item.quantity} {item.unit}{item.note ? ` · ${item.note}` : ''}</span>
                    </div>
                    <button className="remove-button" type="button" onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {completedCount > 0 && <button className="clear-button" type="button" onClick={clearCompleted}>Retirar productos comprados</button>}
            <div className="list-footnote"><span>🔒</span> {storageError || 'Los datos se guardan en este dispositivo. La sincronización familiar requiere configurar el backend seguro.'}</div>
          </section>
        </div>

        <footer className="app-footer"><span>Mi Compra</span><span>Pequeños gestos, compras más fáciles.</span></footer>
      </div>
    </main>
  )
}

export default App
