import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { loadLocalWorkspace, saveActiveWorkspace, saveLocalItems } from './data/localDatabase'
import { pullRemoteItems, synchronizeWorkspace } from './data/syncService'
import { isSupabaseConfigured, supabase } from './data/supabaseClient'
import type { Category, Household, ShoppingItem, ShoppingList } from './domain/shopping'

type Filter = 'Pendientes' | 'Todo' | 'Comprados'
type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'paused'

const SYNC_PAUSED_KEY = 'mi-compra.sync-paused.v1'
const SYNC_DISCONNECTED_KEY = 'mi-compra.sync-disconnected.v1'

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
  const [hasInitialSync, setHasInitialSync] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncDisconnected, setSyncDisconnected] = useState(() => {
    try { return localStorage.getItem(SYNC_DISCONNECTED_KEY) === 'true' } catch { return false }
  })
  const [syncPaused, setSyncPaused] = useState(() => {
    try { return localStorage.getItem(SYNC_PAUSED_KEY) === 'true' } catch { return false }
  })
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('ud.')
  const [category, setCategory] = useState<Category>('Otros')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<Filter>('Pendientes')
  const [accountScreenOpen, setAccountScreenOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [householdName, setHouseholdName] = useState('Mi casa')
  const [createdInvite, setCreatedInvite] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')

  const workspaceRef = useRef({ household, list })
  const itemsRef = useRef(items)
  const syncInFlightRef = useRef(false)
  const syncAgainRef = useRef(false)
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
        setHasInitialSync(false)
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

  async function runSync(force = false, pausedAfterSync = syncPaused, disconnectedAfterSync = syncDisconnected) {
    if (!session || !isReady || !isOnline || ((syncPaused || syncDisconnected) && !force)) return
    if (syncInFlightRef.current) {
      syncAgainRef.current = true
      return
    }
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
      const latestLocalItems = itemsRef.current.map((item) => ({
        ...item,
        id: result.idRemap[item.id] ?? item.id,
      }))
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
      const hasPendingLocalChanges = JSON.stringify(finalItems) !== JSON.stringify(result.items)
      workspaceRef.current = { household: result.household, list: result.list }
      itemsRef.current = finalItems
      lastSyncedSnapshotRef.current = JSON.stringify(result.items)
      setHousehold(result.household)
      setList(result.list)
      setItems(finalItems)
      hasInitialSyncRef.current = true
      setHasInitialSync(true)
      setSyncState(disconnectedAfterSync ? 'local' : pausedAfterSync ? 'paused' : hasPendingLocalChanges ? 'syncing' : 'synced')
      setSyncMessage(hasPendingLocalChanges
        ? 'Sincronización actualizada; enviando los últimos cambios locales.'
        : 'Cambios guardados y sincronizados.')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'No se pudo sincronizar. Los cambios siguen guardados en este dispositivo.'
      if (errorMessage.startsWith('HOUSEHOLD_MEMBERSHIP_REVOKED:')) {
        try { localStorage.setItem(SYNC_DISCONNECTED_KEY, 'true') } catch { /* El estado se mantiene en memoria. */ }
        try { localStorage.removeItem(SYNC_PAUSED_KEY) } catch { /* La desvinculación prevalece sobre la pausa. */ }
        setSyncDisconnected(true)
        setSyncPaused(false)
        hasInitialSyncRef.current = false
        setHasInitialSync(false)
        lastSyncedSnapshotRef.current = ''
        setSyncState('local')
        setSyncMessage('Esta cuenta ya no pertenece a este hogar. Puedes crear uno nuevo o introducir un código de invitación.')
        try { await saveActiveWorkspace(workspaceRef.current.household, workspaceRef.current.list, false) } catch { /* La lista local se conserva. */ }
      } else {
        setSyncState(disconnectedAfterSync ? 'local' : pausedAfterSync ? 'paused' : navigator.onLine ? 'error' : 'offline')
        setSyncMessage(errorMessage)
      }
    } finally {
      syncInFlightRef.current = false
      if (syncAgainRef.current) {
        syncAgainRef.current = false
        if (session && isReady && isOnline && !syncPaused && !syncDisconnected) {
          window.setTimeout(() => { void runSync() }, 150)
        }
      }
    }
  }

  useEffect(() => {
    if (sessionReady && isReady && session && isOnline && !syncPaused && !syncDisconnected) void runSync()
    if (session && !isOnline) setSyncState('offline')
  }, [session?.user.id, sessionReady, isReady, isOnline, syncPaused, syncDisconnected])

  useEffect(() => {
    if (!isReady) return
    void saveLocalItems(list.id, items).catch(() => {
      setStorageError('No se pudo guardar la lista en este dispositivo. Comprueba el espacio disponible del navegador.')
    })
    if (!session || !isOnline || syncPaused || syncDisconnected || !hasInitialSyncRef.current) return
    const snapshot = JSON.stringify(items)
    if (snapshot === lastSyncedSnapshotRef.current) return
    const timer = window.setTimeout(() => { void runSync() }, 850)
    return () => window.clearTimeout(timer)
  }, [items, isReady, list.id, session?.user.id, isOnline, syncPaused, syncDisconnected])

  useEffect(() => {
    if (!session || syncPaused || syncDisconnected || !isSupabaseConfigured || !supabase || !hasInitialSync) return
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
  }, [session?.user.id, list.id, syncPaused, syncDisconnected, hasInitialSync])

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
          options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
        })
        if (error) throw error
        if (!data.session) {
          setAuthMessage('Cuenta creada. Revisa tu correo y confirma la dirección para poder iniciar sesión.')
        } else {
          setAuthMessage('Cuenta creada y sesión iniciada.')
          setAccountScreenOpen(false)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        setAccountScreenOpen(false)
        setPassword('')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo completar la autenticación.')
    } finally {
      setAuthBusy(false)
    }
  }

  function toggleSyncPause() {
    if (syncInFlightRef.current && !syncPaused) return
    if (syncPaused) {
      try { localStorage.removeItem(SYNC_PAUSED_KEY) } catch { /* La preferencia también se mantiene en memoria. */ }
      setSyncPaused(false)
      setSyncMessage('Reanudando sincronización…')
      void runSync(true, false)
    } else {
      try { localStorage.setItem(SYNC_PAUSED_KEY, 'true') } catch { /* La pausa se mantiene en memoria durante esta sesión. */ }
      setSyncPaused(true)
      setSyncState('paused')
      setSyncMessage('La sincronización está pausada en este dispositivo. Tus cambios siguen guardándose aquí.')
    }
  }

  async function disconnectSync() {
    if (!supabase || !session || syncInFlightRef.current) return
    syncInFlightRef.current = true
    setSyncState('syncing')
    setSyncMessage('Desvinculando esta cuenta del hogar…')
    try {
      const { error } = await supabase.rpc('leave_household', {
        target_household_id: household.id,
      })
      if (error) throw error
      try { localStorage.setItem(SYNC_DISCONNECTED_KEY, 'true') } catch { /* El estado se mantiene en memoria. */ }
      try { localStorage.removeItem(SYNC_PAUSED_KEY) } catch { /* La desvinculación prevalece sobre la pausa. */ }
      setSyncDisconnected(true)
      setSyncPaused(false)
      hasInitialSyncRef.current = false
      setHasInitialSync(false)
      lastSyncedSnapshotRef.current = ''
      setSyncState('local')
      setSyncMessage('Esta cuenta ya no pertenece al hogar. Tus productos se conservan en este dispositivo.')
      await saveActiveWorkspace(household, list, false)
    } catch (error) {
      setSyncState('error')
      setSyncMessage(error instanceof Error ? error.message : 'No se pudo desvincular la cuenta del hogar.')
    } finally {
      syncInFlightRef.current = false
    }
  }

  async function createNewHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !session || !isOnline || inviteBusy || !householdName.trim()) return
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { data: newHouseholdId, error } = await supabase.rpc('create_household_fresh', {
        household_name: householdName.trim(),
      })
      if (error) throw error
      if (typeof newHouseholdId !== 'string') throw new Error('Supabase no devolvió el identificador del nuevo hogar.')
      const nextHousehold: Household = {
        id: newHouseholdId,
        name: householdName.trim(),
        createdAt: Date.now(),
      }
      workspaceRef.current = { household: nextHousehold, list }
      setHousehold(nextHousehold)
      try { localStorage.removeItem(SYNC_DISCONNECTED_KEY) } catch { /* El estado se mantiene en memoria. */ }
      try { localStorage.removeItem(SYNC_PAUSED_KEY) } catch { /* El nuevo hogar comienza sincronizando. */ }
      setSyncDisconnected(false)
      setSyncPaused(false)
      hasInitialSyncRef.current = false
      setHasInitialSync(false)
      lastSyncedSnapshotRef.current = ''
      await saveActiveWorkspace(nextHousehold, list, false)
      setInviteMessage('Hogar creado. Preparando la lista compartida…')
      await runSync(true, false, false)
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo crear el hogar.')
    } finally {
      setInviteBusy(false)
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

  async function createHouseholdInvite() {
    if (!supabase || !session) return
    setInviteBusy(true)
    setInviteMessage('')
    setCreatedInvite('')
    try {
      const { data, error } = await supabase.rpc('create_household_invite', {
        target_household_id: household.id,
      })
      if (error) throw error
      const invitation = Array.isArray(data) ? data[0] : data
      if (!invitation?.invite_code) throw new Error('Supabase no devolvió un código de invitación.')
      setCreatedInvite(invitation.invite_code)
      try {
        await navigator.clipboard.writeText(invitation.invite_code)
        setInviteMessage('Código copiado. Compártelo con las personas que quieras añadir al hogar.')
      } catch {
        setInviteMessage('Copia el código que aparece abajo y compártelo con tu familia.')
      }
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo crear la invitación.')
    } finally {
      setInviteBusy(false)
    }
  }

  async function acceptHouseholdInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !session || !inviteCode.trim()) return
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { data: joinedHouseholdId, error } = await supabase.rpc('accept_household_invite', {
        invitation_code: inviteCode.trim(),
      })
      if (error) throw error
      if (typeof joinedHouseholdId !== 'string') throw new Error('Supabase no devolvió el hogar al que te has unido.')
      const nextHousehold = { ...workspaceRef.current.household, id: joinedHouseholdId }
      workspaceRef.current = { household: nextHousehold, list: workspaceRef.current.list }
      setHousehold(nextHousehold)
      setInviteCode('')
      try { localStorage.removeItem(SYNC_DISCONNECTED_KEY) } catch { /* El estado se mantiene en memoria. */ }
      try { localStorage.removeItem(SYNC_PAUSED_KEY) } catch { /* Unirse a un hogar reanuda la sincronización. */ }
      setSyncDisconnected(false)
      setSyncPaused(false)
      hasInitialSyncRef.current = false
      setHasInitialSync(false)
      lastSyncedSnapshotRef.current = ''
      await saveActiveWorkspace(nextHousehold, workspaceRef.current.list, false)
      setInviteMessage('Te has unido al hogar. Estamos incorporando y sincronizando tu lista.')
      await runSync(true, false, false)
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo aceptar la invitación.')
    } finally {
      setInviteBusy(false)
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
    setItems((current) => {
      const next = [newItem, ...current]
      itemsRef.current = next
      return next
    })
    setName('')
    setQuantity('1')
    setUnit('ud.')
    setNote('')
  }

  function toggleItem(id: string) {
    const now = Date.now()
    setItems((current) => {
      const next = current.map((item) => item.id === id
        ? { ...item, completed: !item.completed, updatedAt: now }
        : item)
      itemsRef.current = next
      return next
    })
  }

  function removeItem(id: string) {
    const now = Date.now()
    setItems((current) => {
      const next = current.map((item) => item.id === id
        ? { ...item, deletedAt: now, updatedAt: now }
        : item)
      itemsRef.current = next
      return next
    })
  }

  function clearCompleted() {
    const now = Date.now()
    setItems((current) => {
      const next = current.map((item) => item.completed && !item.deletedAt
        ? { ...item, deletedAt: now, updatedAt: now }
        : item)
      itemsRef.current = next
      return next
    })
    setFilter('Pendientes')
  }

  const syncLabel = !session
    ? 'Solo en este dispositivo'
    : syncDisconnected
      ? 'Sincronización desconectada'
      : syncPaused
      ? 'Sincronización pausada'
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
            <button className="account-button account-menu-trigger" type="button" aria-expanded={accountScreenOpen} onClick={() => setAccountScreenOpen((open) => !open)}>
              <span className={syncState === 'synced' && !syncPaused ? 'online-dot' : 'status-dot'} />
              <span className="account-menu-label">{accountScreenOpen ? 'Volver a la lista' : session ? household.name : 'Cuenta y sincronización'}</span>
              <span aria-hidden="true">{accountScreenOpen ? '←' : '⚙'}</span>
            </button>
          </div>
        </header>

        {accountScreenOpen ? (
          <section className="account-page" aria-label="Cuenta y sincronización">
            <div className="account-page-heading">
              <button className="back-to-list" type="button" onClick={() => setAccountScreenOpen(false)}>← Volver a la lista</button>
              <p className="eyebrow">AJUSTES DE MI COMPRA</p>
              <h1>Cuenta y sincronización</h1>
              <p>Consulta tu cuenta y decide en qué hogar compartes la lista.</p>
            </div>
            <div className="account-page-grid">
              <section className="account-page-card">
                <p className="field-label">CUENTA</p>
                {session ? (
                  <>
                    <p className="account-user-email">{session.user.email}</p>
                    <p className="auth-note">La sesión permanece abierta aunque desvincules esta cuenta del hogar actual.</p>
                    <button className="auth-switch" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
                  </>
                ) : (
                  <>
                    <div className="auth-heading"><div><p className="eyebrow">SINCRONIZACIÓN FAMILIAR</p><h2>{authMode === 'login' ? 'Entra en tu cuenta' : 'Crea tu cuenta'}</h2></div><span className="auth-lock">🔐</span></div>
                    {!isSupabaseConfigured ? <p className="auth-feedback error">Falta configurar la conexión con Supabase en esta instalación.</p> : (
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
                    {isSupabaseConfigured && <button className="auth-switch" type="button" onClick={() => { setAuthMode((mode) => mode === 'login' ? 'register' : 'login'); setAuthError(''); setAuthMessage('') }}>{authMode === 'login' ? '¿Aún no tienes cuenta? Crear una cuenta' : 'Ya tengo cuenta. Iniciar sesión'}</button>}
                  </>
                )}
              </section>
              {session && (
                <>
                  <section className="account-page-card">
                    <p className="field-label">ESTADO DE SINCRONIZACIÓN</p>
                    <div className={`account-sync-status sync-${syncDisconnected ? 'disconnected' : syncPaused ? 'paused' : syncState}`}>
                      <span className="sync-indicator" />
                      <div><strong>{syncLabel}</strong><small>{syncMessage || (syncDisconnected ? 'Este dispositivo no envía ni recibe cambios.' : syncPaused ? 'La sincronización está detenida temporalmente.' : 'La lista se comparte con los dispositivos conectados a este hogar.')}</small></div>
                    </div>
                    <div className="sync-details">
                      <div><span>{syncDisconnected ? "Último hogar conectado" : "Hogar conectado"}</span><strong>{household.name}</strong></div>
                      <div><span>{syncDisconnected ? "Lista conservada en este dispositivo" : "Lista compartida"}</span><strong>{list.name}</strong></div>
                      <div><span>Conexión</span><strong>{isOnline ? 'Internet disponible' : 'Sin conexión a Internet'}</strong></div>
                    </div>
                    <div className="account-actions">
                      {!syncDisconnected && (
                        <>
                          <button className="add-button" type="button" onClick={() => void runSync(true)} disabled={!isOnline || syncState === 'syncing'}>{syncState === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
                          <button className="secondary-action" type="button" onClick={toggleSyncPause} disabled={syncState === 'syncing' && !syncPaused}>{syncPaused ? 'Reanudar sincronización' : 'Pausar temporalmente'}</button>
                          <button className="danger-action" type="button" onClick={() => void disconnectSync()} disabled={syncState === 'syncing'}>Desvincular cuenta de este hogar</button>
                        </>
                      )}
                    </div>
                    <p className="auth-note">{syncDisconnected
                      ? 'Esta cuenta ya no pertenece a este hogar. Los demás miembros pueden seguir utilizándolo y sincronizando con normalidad.'
                      : 'Desvincular elimina la pertenencia de esta cuenta a este hogar en todos sus dispositivos. Los demás miembros no se ven afectados y la lista compartida se conserva.'}</p>
                  </section>
                  <section className="account-page-card">
                    <p className="field-label">{syncDisconnected ? 'CREAR O ELEGIR HOGAR' : 'COMPARTIR HOGAR'}</p>
                    <p className="auth-note">{syncDisconnected
                      ? 'Tu lista permanece en este dispositivo. Puedes crear un hogar nuevo o unirte con un código que te hayan enviado.'
                      : 'Invita a otras personas para compartir la lista o únete a otro hogar con un código.'}</p>
                    {!syncDisconnected && (
                      <>
                        <button className="add-button" type="button" onClick={() => void createHouseholdInvite()} disabled={inviteBusy || syncState !== 'synced' || syncPaused}>{inviteBusy ? 'Un momento…' : 'Crear código para invitar'}</button>
                        {createdInvite && <div className="invite-code" aria-label="Código de invitación"><strong>{createdInvite}</strong></div>}
                      </>
                    )}
                    {syncDisconnected && (
                      <form className="auth-form" onSubmit={createNewHousehold}>
                        <label className="field-label" htmlFor="new-household-name">Nombre del nuevo hogar</label>
                        <input id="new-household-name" className="text-input" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} maxLength={80} required />
                        <button className="add-button" type="submit" disabled={inviteBusy || !isOnline || !householdName.trim()}>{inviteBusy ? 'Creando…' : 'Crear hogar nuevo'}</button>
                      </form>
                    )}
                    <form className="auth-form invite-form" onSubmit={acceptHouseholdInvite}>
                      <label className="field-label" htmlFor="household-invite-code">Código de invitación recibido</label>
                      <input id="household-invite-code" className="text-input" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Pega aquí el código recibido" autoComplete="off" required />
                      <button className="auth-switch" type="submit" disabled={inviteBusy || !isOnline || (!syncDisconnected && (syncState !== 'synced' || syncPaused)) || !inviteCode.trim()}>Unirme a un hogar</button>
                    </form>
                    {inviteMessage && <p className="auth-feedback" role="status">{inviteMessage}</p>}
                    {!syncDisconnected && <p className="auth-note">Los códigos caducan a los 7 días y admiten hasta 10 incorporaciones.</p>}
                  </section>
                </>
              )}
            </div>
          </section>
        ) : (
        <>
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
                  <input id="product-quantity" className="text-input" type="number" min="0.001" step="any" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
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
              <button className="add-button" type="submit" disabled={!isReady || Boolean(storageError) || !name.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0}>Añadir a la lista <span>＋</span></button>
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
        </>
        )}
      </div>
    </main>
  )
}

export default App
