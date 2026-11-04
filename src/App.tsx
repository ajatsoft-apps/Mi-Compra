import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { loadLocalWorkspace, saveLocalItems } from './data/localDatabase'
import { pullRemoteItems, synchronizeWorkspace } from './data/syncService'
import { isSupabaseConfigured, supabase } from './data/supabaseClient'
import type { Category, Household, ShoppingItem, ShoppingList } from './domain/shopping'

type Filter = 'Pendientes' | 'Todo' | 'Comprados'
type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

const categories: Category[] = ['Fruta y verdura', 'Lácteos', 'Despensa', 'Bebidas', 'Hogar', 'Otros']
const categoryIcons: Record<Category, string> = {
  'Fruta y verdura': '🥑',
  Lácteos: '🥛',
  Despensa: '🥫',
  Bebidas: '🧃',
  Hogar: '🧽',
  Otros: '🛒',
}

function createItemId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  throw new Error('Actualiza el navegador para poder crear identificadores seguros.')
}

function App() {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [household, setHousehold] = useState<Household>({ id: 'household-local', name: 'Mi casa', createdAt: Date.now() })
  const [list, setList] = useState<ShoppingList>({ id: 'shopping-list-default', householdId: 'household-local', name: 'Lista de casa', createdAt: Date.now() })
  const [storageError, setStorageError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncState, setSyncState] = useState<SyncState>('local')
  const [syncMessage, setSyncMessage] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('ud.')
  const [category, setCategory] = useState<Category>('Otros')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<Filter>('Pendientes')
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')

  const workspaceRef = useRef({ household, list })
  const itemsRef = useRef(items)
  const syncInFlightRef = useRef(false)
  const hasInitialSyncRef = useRef(false)
  const lastSyncedSnapshotRef = useRef('')

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { workspaceRef.current = { household, list } }, [household, list])

  useEffect(() => {
    let active = true
    loadLocalWorkspace().then((workspace) => {
      if (!active) return
      setItems(workspace.items)
      itemsRef.current = workspace.items
      setHousehold(workspace.household)
      setList(workspace.list)
      workspaceRef.current = { household: workspace.household, list: workspace.list }
      setSyncState(workspace.remote ? 'offline' : 'local')
      setIsReady(true)
    }).catch(() => {
      if (active) {
        setStorageError('No se pudo recuperar el almacenamiento local. Comprueba el espacio disponible del navegador.')
        setIsReady(true)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setSessionReady(true)
      return
    }
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionReady(true)
      if (!nextSession) {
        hasInitialSyncRef.current = false
        lastSyncedSnapshotRef.current = ''
        setSyncState('local')
      }
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      setSession(data.session)
      setSessionReady(true)
    }).catch((error: unknown) => {
      if (active) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo recuperar la sesión.')
        setSessionReady(true)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  async function runSync() {
    if (!session || !isReady || !isOnline || syncInFlightRef.current) return
    syncInFlightRef.current = true
    setSyncState('syncing')
    setSyncMessage('')
    try {
      const currentWorkspace = workspaceRef.current
      const startingItems = itemsRef.current
      const result = await synchronizeWorkspace(
        session.user,
        currentWorkspace.household,
        currentWorkspace.list,
        startingItems,
      )
      const latestLocalItems = itemsRef.current
      const mergedById = new Map(result.items.map((item) => [item.id, item]))
      for (const localItem of latestLocalItems) {
        const remoteItem = mergedById.get(localItem.id)
        if (!remoteItem || localItem.updatedAt > remoteItem.updatedAt) {
          mergedById.set(localItem.id, {
            ...localItem,
            householdId: result.household.id,
            listId: result.list.id,
          })
        }
      }
      const finalItems = [...mergedById.values()]
      workspaceRef.current = { household: result.household, list: result.list }
      itemsRef.current = finalItems
      lastSyncedSnapshotRef.current = JSON.stringify(result.items)
      setHousehold(result.household)
      setList(result.list)
      setItems(finalItems)
      hasInitialSyncRef.current = true
      setSyncState('synced')
      setSyncMessage(finalItems.length === result.items.length
        ? 'Cambios guardados y sincronizados.'
        : 'Sincronización actualizada; enviando los últimos cambios locales.')
    } catch (error) {
      setSyncState(navigator.onLine ? 'error' : 'offline')
      setSyncMessage(error instanceof Error ? error.message : 'No se pudo sincronizar. Los cambios siguen guardados en este dispositivo.')
    } finally {
      syncInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (sessionReady && isReady && session && isOnline) void runSync()
    if (session && !isOnline) setSyncState('offline')
  }, [session?.user.id, sessionReady, isReady, isOnline])

  useEffect(() => {
    if (!isReady) return
    void saveLocalItems(list.id, items).catch(() => {
      setStorageError('No se pudo guardar la lista en este dispositivo. Comprueba el espacio disponible del navegador.')
    })
    if (!session || !isOnline || !hasInitialSyncRef.current) return
    const snapshot = JSON.stringify(items)
    if (snapshot === lastSyncedSnapshotRef.current) return
    const timer = window.setTimeout(() => { void runSync() }, 850)
    return () => window.clearTimeout(timer)
  }, [items, isReady, list.id, session?.user.id, isOnline])

  useEffect(() => {
    if (!session || !isSupabaseConfigured || !supabase || !hasInitialSyncRef.current) return
    const client = supabase
    const channel = client
      .channel(`shopping-list-${list.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shopping_list_items',
        filter: `list_id=eq.${list.id}`,
      }, async () => {
        try {
          const remoteItems = await pullRemoteItems(list.id)
          const localById = new Map(itemsRef.current.map((item) => [item.id, item]))
          const merged = remoteItems.map((remoteItem) => {
            const localItem = localById.get(remoteItem.id)
            return localItem && localItem.updatedAt > remoteItem.updatedAt ? localItem : remoteItem
          })
          const remoteIds = new Set(remoteItems.map((item) => item.id))
          for (const localItem of itemsRef.current) {
            if (!remoteIds.has(localItem.id)) merged.push(localItem)
          }
          itemsRef.current = merged
          setItems(merged)
        } catch {
          setSyncState('offline')
          setSyncMessage('No se pudo actualizar en tiempo real. Se reintentará al recuperar la conexión.')
        }
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [session?.user.id, list.id])

  const activeItems = useMemo(() => items.filter((item) => !item.deletedAt), [items])
  const pendingCount = activeItems.filter((item) => !item.completed).length
  const completedCount = activeItems.length - pendingCount
  const visibleItems = useMemo(() => {
    const filtered = activeItems.filter((item) => {
      if (filter === 'Pendientes') return !item.completed
      if (filter === 'Comprados') return item.completed
      return true
    })
    return filtered.sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt)
  }, [activeItems, filter])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) {
      setAuthError('La conexión con Supabase todavía no está configurada en este entorno.')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) {
          setAuthMessage('Cuenta creada. Revisa tu correo y confirma la dirección para poder iniciar sesión.')
        } else {
          setAuthMessage('Cuenta creada y sesión iniciada.')
          setShowAuth(false)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        setShowAuth(false)
        setPassword('')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo completar la autenticación.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setAuthError(error.message)
    else {
      setPassword('')
      setAuthMessage('Sesión cerrada. La lista local permanece disponible en este dispositivo.')
    }
  }

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    const parsedQuantity = Number(quantity)
    if (!cleanName || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return

    const now = Date.now()
    const newItem: ShoppingItem = {
      id: createItemId(),
      name: cleanName,
      quantity: parsedQuantity,
      unit: unit.trim() || 'ud.',
      category,
      note: note.trim(),
      completed: false,
      createdAt: now,
      updatedAt: now,
      householdId: household.id,
      listId: list.id,
      deletedAt: null,
    }
    setItems((current) => [newItem, ...current])
    setName('')
    setQuantity('1')
    setUnit('ud.')
    setNote('')
  }

  function toggleItem(id: string) {
    const now = Date.now()
    setItems((current) => current.map((item) => item.id === id
      ? { ...item, completed: !item.completed, updatedAt: now }
      : item))
  }

  function removeItem(id: string) {
    const now = Date.now()
    setItems((current) => current.map((item) => item.id === id
      ? { ...item, deletedAt: now, updatedAt: now }
      : item))
  }

  function clearCompleted() {
    const now = Date.now()
    setItems((current) => current.map((item) => item.completed && !item.deletedAt
      ? { ...item, deletedAt: now, updatedAt: now }
      : item))
    setFilter('Pendientes')
  }

  const syncLabel = !session
    ? 'Solo en este dispositivo'
    : syncState === 'syncing'
      ? 'Sincronizando…'
      : syncState === 'synced'
        ? 'Sincronizado'
        : syncState === 'offline'
          ? 'Sin conexión · guardado local'
          : syncState === 'error'
            ? 'Pendiente de sincronizar'
            : 'Preparando sincronización'

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Mi Compra, inicio">
            <span className="brand-mark" aria-hidden="true">✓</span>
            <span><strong>Mi Compra</strong><small>La compra de casa, en orden</small></span>
          </a>
          <div className="topbar-actions">
            {session ? (
              <div className="account-pill">
                <span className="online-dot" />
                <span className="account-email">{session.user.email}</span>
                <button type="button" onClick={() => void signOut()}>Salir</button>
              </div>
            ) : (
              <button className="account-button" type="button" onClick={() => setShowAuth((value) => !value)}>
                {showAuth ? 'Cerrar' : 'Conectar cuenta'}
              </button>
            )}
            <div className="household-pill"><span className={syncState === 'synced' ? 'online-dot' : 'status-dot'} /> {household.name} <span className="pill-avatar">⌂</span></div>
          </div>
        </header>

        {showAuth && !session && (
          <section className="auth-panel" aria-label="Acceso a Mi Compra">
            <div className="auth-heading">
              <div><p className="eyebrow">SINCRONIZACIÓN FAMILIAR</p><h2>{authMode === 'login' ? 'Entra en tu cuenta' : 'Crea tu cuenta'}</h2></div>
              <span className="auth-lock">🔐</span>
            </div>
            {!isSupabaseConfigured ? (
              <p className="auth-feedback error">Falta configurar la URL y la clave publicable de Supabase en las variables de entorno de esta instalación.</p>
            ) : (
              <form className="auth-form" onSubmit={submitAuth}>
                <label className="field-label" htmlFor="account-email">Correo electrónico</label>
                <input id="account-email" className="text-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="tu@correo.com" />
                <label className="field-label auth-password-label" htmlFor="account-password">Contraseña</label>
                <input id="account-password" className="text-input" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Al menos 8 caracteres" />
                <button className="add-button" type="submit" disabled={authBusy || !sessionReady}>{authBusy ? 'Un momento…' : authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
              </form>
            )}
            {authError && <p className="auth-feedback error" role="alert">{authError}</p>}
            {authMessage && <p className="auth-feedback" role="status">{authMessage}</p>}
            {isSupabaseConfigured && <button className="auth-switch" type="button" onClick={() => { setAuthMode((mode) => mode === 'login' ? 'register' : 'login'); setAuthError(''); setAuthMessage('') }}>
              {authMode === 'login' ? '¿Aún no tienes cuenta? Crear una cuenta' : 'Ya tengo cuenta. Iniciar sesión'}
            </button>}
            <p className="auth-note">La lista seguirá disponible sin conexión. Al iniciar sesión, se vinculará a tu hogar y se sincronizará con tus otros dispositivos.</p>
          </section>
        )}

        <div className={`sync-banner sync-${syncState}`} role="status">
          <span className="sync-indicator" />
          <span>{syncLabel}</span>
          {syncMessage && <small>{syncMessage}</small>}
          {!session && isSupabaseConfigured && <button type="button" onClick={() => setShowAuth(true)}>Activar sincronización</button>}
        </div>

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
              <input id="product-name" className="text-input product-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Leche semidesnatada" maxLength={120} required />
              <div className="quantity-row">
                <div className="quantity-field">
                  <label className="field-label" htmlFor="product-quantity">Cantidad</label>
                  <input id="product-quantity" className="text-input" type="number" min="0.001" step="0.1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
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
              <div><p className="eyebrow">COMPRA FAMILIAR</p><h2>{list.name} <span className="item-count">{pendingCount}</span></h2></div>
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
            <div className="list-footnote"><span>🔒</span> {storageError || (session ? 'Los cambios se guardan localmente y se sincronizan con el hogar.' : 'Los datos se guardan en este dispositivo. Conecta una cuenta para compartir la lista.')}</div>
          </section>
        </div>

        <footer className="app-footer"><span>Mi Compra</span><span>Pequeños gestos, compras más fáciles.</span></footer>
      </div>
    </main>
  )
}

export default App
