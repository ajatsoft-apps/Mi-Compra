import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { loadLocalWorkspace, saveActiveWorkspace, saveLocalItems } from './data/localDatabase'
import { pullRemoteItems, synchronizeWorkspace } from './data/syncService'
import { isSupabaseConfigured, supabase } from './data/supabaseClient'
import type { Category, Household, ShoppingItem, ShoppingList, ShoppingStore } from './domain/shopping'
import ProductCatalog, { type CatalogProduct } from './ProductCatalog'
import MarketPrices from './MarketPrices'
import BasketOptimizer from './BasketOptimizer'
import LidlOffers from './LidlOffers'
import ProductAutocomplete, { type ProductSuggestion } from './ProductAutocomplete'

type Filter = 'Pendientes' | 'Todo' | 'Comprados'
type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'paused'
type HouseholdMemberInfo = { member_user_id: string; member_email: string | null; member_role: 'owner' | 'member'; member_joined_at: string }
type HouseholdInviteInfo = { invite_id: string; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; use_count: number; max_uses: number }

const SYNC_PAUSED_KEY = 'mi-compra.sync-paused.v1'
const SYNC_DISCONNECTED_KEY = 'mi-compra.sync-disconnected.v1'

const categories: Category[] = ['Fruta y verdura', 'Lácteos', 'Despensa', 'Bebidas', 'Hogar', 'Otros']
const firstEnabledStore: Exclude<ShoppingStore, 'general'> = 'lidl'
const storeLabels: Record<ShoppingStore, string> = { lidl: 'Lidl', mercadona: 'Mercadona', general: 'Otros' }
const euroCurrency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

function pdfHex(value: string): string {
  return Array.from(value).map((character) => {
    const code = character.codePointAt(0) ?? 63
    const byte = code === 0x20ac ? 0x80 : code <= 0xff ? code : 0x3f
    return byte.toString(16).padStart(2, '0')
  }).join('').toUpperCase()
}

function createShoppingListPdf(title: string, items: ShoppingItem[]): Blob {
  const date = new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
  const priced = items.filter((item) => item.unitPrice != null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0)
  const missing = items.length - priced.length
  const total = priced.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.quantity, 0)
  const lines = [
    'MI COMPRA - ' + title.toLocaleUpperCase('es'),
    'Generada el ' + date,
    '',
    ...items.flatMap((item) => {
      const amount = item.unitPrice == null ? 'Sin precio' : euroCurrency.format(item.unitPrice * item.quantity)
      const status = item.completed ? '[COMPRADO]' : '[PENDIENTE]'
      const detail = [String(item.quantity) + ' ' + item.unit, item.unitPrice == null ? '' : euroCurrency.format(item.unitPrice) + ' / ' + item.unit, amount, status].filter(Boolean).join(' | ')
      return [item.name, '  ' + detail, ...(item.note ? ['  Nota: ' + item.note] : [])]
    }),
    '',
    'TOTAL ESTIMADO: ' + euroCurrency.format(total),
    missing ? missing + ' producto(s) sin precio. Total parcial.' : 'Todos los productos tienen precio.',
    'Los precios son orientativos y pueden variar en tienda.',
  ]
  const pages: string[][] = []
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48))
  if (pages.length === 0) pages.push(['La lista está vacía.'])
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const commands = pageLines.map((line, lineIndex) => {
      const fontSize = lineIndex === 0 ? 16 : 10
      const y = 790 - lineIndex * 15
      return 'BT /F1 ' + fontSize + ' Tf 48 ' + y + ' Td <' + pdfHex(line) + '> Tj ET'
    }).join('\n')
    objects[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>'
    objects[contentId] = '<< /Length ' + commands.length + ' >>\nstream\n' + commands + '\nendstream'
  })
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = new TextEncoder().encode(pdf).length
    pdf += id + ' 0 obj\n' + objects[id] + '\nendobj\n'
  }
  const xrefOffset = new TextEncoder().encode(pdf).length
  pdf += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n'
  for (let id = 1; id < objects.length; id++) pdf += String(offsets[id]).padStart(10, '0') + ' 00000 n \n'
  pdf += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF'
  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' })
}

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

function normalizeItemValue(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}

function canMergeShoppingItems(existing: ShoppingItem, incoming: ShoppingItem): boolean {
  if (existing.completed || existing.deletedAt) return false
  if ((existing.supermarket ?? 'general') !== (incoming.supermarket ?? 'general')) return false
  if (normalizeItemValue(existing.name) !== normalizeItemValue(incoming.name)) return false
  if (normalizeItemValue(existing.unit) !== normalizeItemValue(incoming.unit)) return false
  if (existing.catalogProductId && incoming.catalogProductId && existing.catalogProductId !== incoming.catalogProductId) return false
  if (existing.unitPrice != null && incoming.unitPrice != null && Math.abs(existing.unitPrice - incoming.unitPrice) >= 0.01) return false
  if (existing.catalogProductId === incoming.catalogProductId && existing.catalogProductId) return true
  return !existing.note.trim() || !incoming.note.trim() || normalizeItemValue(existing.note) === normalizeItemValue(incoming.note)
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
  const [price, setPrice] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [mobileAddOpen, setMobileAddOpen] = useState(false)
  const [exportFeedback, setExportFeedback] = useState('')
  const [filter, setFilter] = useState<Filter>('Pendientes')
  const [selectedStore, setSelectedStore] = useState<ShoppingStore>(firstEnabledStore)
  const [accountScreenOpen, setAccountScreenOpen] = useState(false)
  const [catalogScreenOpen, setCatalogScreenOpen] = useState(false)
  const [marketPricesOpen, setMarketPricesOpen] = useState(false)
  const [lidlOffersOpen, setLidlOffersOpen] = useState(false)
  const [optimizerOpen, setOptimizerOpen] = useState(false)
  const [catalogSavePrompt, setCatalogSavePrompt] = useState<{ product: ProductSuggestion; itemId: string } | null>(null)
  const [catalogSaveBusy, setCatalogSaveBusy] = useState(false)
  const [catalogSaveFeedback, setCatalogSaveFeedback] = useState('')
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
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMemberInfo[]>([])
  const [householdInvites, setHouseholdInvites] = useState<HouseholdInviteInfo[]>([])
  const [householdManagementBusy, setHouseholdManagementBusy] = useState(false)
  const [householdManagementError, setHouseholdManagementError] = useState('')
  const hasRemoteHousehold = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(household.id)
  const isHouseholdOwner = householdMembers.some((member) => member.member_user_id === session?.user.id && member.member_role === 'owner')

  const workspaceRef = useRef({ household, list })
  const itemsRef = useRef(items)
  const syncInFlightRef = useRef(false)
  const syncAgainRef = useRef(false)
  const hasInitialSyncRef = useRef(false)
  const lastSyncedSnapshotRef = useRef('')

  useEffect(() => {
    if (!mobileAddOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileAddOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileAddOpen])

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

  useEffect(() => {
    if (!session || !accountScreenOpen || syncDisconnected || !hasRemoteHousehold || !isOnline || !supabase) {
      if (!session || syncDisconnected) {
        setHouseholdMembers([])
        setHouseholdInvites([])
      }
      return
    }
    let active = true
    setHouseholdManagementBusy(true)
    setHouseholdManagementError('')
    Promise.all([
      supabase.rpc('list_household_members', { target_household_id: household.id }),
      supabase.rpc('list_household_invites', { target_household_id: household.id }),
    ]).then(([membersResult, invitesResult]) => {
      if (!active) return
      if (membersResult.error) throw membersResult.error
      if (invitesResult.error) throw invitesResult.error
      setHouseholdMembers((membersResult.data ?? []) as HouseholdMemberInfo[])
      setHouseholdInvites((invitesResult.data ?? []) as HouseholdInviteInfo[])
    }).catch((error: unknown) => {
      if (active) setHouseholdManagementError(error instanceof Error ? error.message : 'No se pudo cargar la gestión del hogar.')
    }).finally(() => {
      if (active) setHouseholdManagementBusy(false)
    })
    return () => { active = false }
  }, [session?.user.id, accountScreenOpen, household.id, hasRemoteHousehold, syncDisconnected, isOnline])

  const activeItems = useMemo(() => items.filter((item) => !item.deletedAt), [items])
  const pendingCount = activeItems.filter((item) => !item.completed).length
  const completedCount = activeItems.length - pendingCount
  const storeItems = useMemo(() => activeItems.filter((item) => (item.supermarket ?? 'general') === selectedStore), [activeItems, selectedStore])
  const storePendingCount = storeItems.filter((item) => !item.completed).length
  const storeCompletedCount = storeItems.length - storePendingCount
  const storePricedItems = storeItems.filter((item) => item.unitPrice != null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0)
  const storeMissingPriceCount = storeItems.length - storePricedItems.length
  const storeEstimatedTotal = storePricedItems.reduce((total, item) => total + (item.unitPrice ?? 0) * item.quantity, 0)
  const visibleItems = useMemo(() => {
    const filtered = storeItems.filter((item) => {
      if (filter === 'Pendientes') return !item.completed
      if (filter === 'Comprados') return item.completed
      return true
    })
    return filtered.sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt)
  }, [storeItems, filter])
  const exportText = useMemo(() => {
    const lines = ['Mi Compra · ' + storeLabels[selectedStore], new Date().toLocaleString('es-ES'), '']
    for (const item of storeItems) {
      const amount = item.unitPrice == null ? 'Sin precio' : euroCurrency.format(item.unitPrice * item.quantity)
      lines.push((item.completed ? '✓' : '○') + ' ' + item.name + ' — ' + item.quantity + ' ' + item.unit + ' — ' + amount)
      if (item.note) lines.push('  ' + item.note)
    }
    lines.push('', 'Total estimado: ' + euroCurrency.format(storeEstimatedTotal))
    if (storeMissingPriceCount > 0) lines.push('Total parcial: ' + storeMissingPriceCount + ' producto(s) sin precio.')
    return lines.join('\n')
  }, [selectedStore, storeItems, storeEstimatedTotal, storeMissingPriceCount])

  function downloadShoppingPdf() {
    const blob = createShoppingListPdf(storeLabels[selectedStore], storeItems)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mi-compra-' + selectedStore + '-' + new Date().toISOString().slice(0, 10) + '.pdf'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    setExportFeedback('PDF preparado para guardar.')
    setExportMenuOpen(false)
  }

  async function shareShoppingPdf() {
    const file = new File([createShoppingListPdf(storeLabels[selectedStore], storeItems)], 'mi-compra-' + selectedStore + '.pdf', { type: 'application/pdf' })
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'Mi Compra · ' + storeLabels[selectedStore], files: [file] })
        setExportFeedback('PDF compartido.')
      } else {
        downloadShoppingPdf()
        setExportFeedback('No se pueden compartir archivos directamente en este navegador. Guarda el PDF y compártelo desde Archivos.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setExportFeedback('No se pudo abrir el menú para compartir el PDF.')
    }
    setExportMenuOpen(false)
  }

  async function shareShoppingText() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mi Compra · ' + storeLabels[selectedStore], text: exportText })
        setExportFeedback('Lista compartida.')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportText)
        setExportFeedback('Lista copiada. Ya puedes pegarla donde quieras.')
      } else {
        setExportFeedback('Este navegador no permite compartir texto directamente.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setExportFeedback('No se pudo compartir la lista.')
    }
    setExportMenuOpen(false)
  }


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

  function detachCatalogReferences() {
    const now = Date.now()
    const next = itemsRef.current.map((item) => item.catalogProductId
      ? { ...item, catalogProductId: null, updatedAt: now }
      : item)
    itemsRef.current = next
    setItems(next)
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
      detachCatalogReferences()
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

  async function refreshHouseholdManagement() {
    if (!supabase) return
    setHouseholdManagementBusy(true)
    setHouseholdManagementError('')
    try {
      const [membersResult, invitesResult] = await Promise.all([
        supabase.rpc('list_household_members', { target_household_id: household.id }),
        supabase.rpc('list_household_invites', { target_household_id: household.id }),
      ])
      if (membersResult.error) throw membersResult.error
      if (invitesResult.error) throw invitesResult.error
      setHouseholdMembers((membersResult.data ?? []) as HouseholdMemberInfo[])
      setHouseholdInvites((invitesResult.data ?? []) as HouseholdInviteInfo[])
    } catch (error) {
      setHouseholdManagementError(error instanceof Error ? error.message : 'No se pudo actualizar la gestión del hogar.')
    } finally {
      setHouseholdManagementBusy(false)
    }
  }

  async function removeHouseholdMember(member: HouseholdMemberInfo) {
    if (!supabase || !session || !window.confirm(`¿Quieres retirar a ${member.member_email || 'este miembro'} del hogar? Dejará de acceder a la lista compartida.`)) return
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { error } = await supabase.rpc('remove_household_member', {
        target_household_id: household.id,
        target_user_id: member.member_user_id,
      })
      if (error) throw error
      setInviteMessage('Miembro retirado. Sus invitaciones pendientes también se han revocado.')
      await refreshHouseholdManagement()
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo retirar al miembro.')
    } finally {
      setInviteBusy(false)
    }
  }

  async function transferHouseholdOwnership(member: HouseholdMemberInfo) {
    if (!supabase || !window.confirm(`Vas a transferir la propiedad del hogar a ${member.member_email || 'este miembro'}. Seguirás dentro como miembro y perderás los permisos de propietario. ¿Continuar?`)) return
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { error } = await supabase.rpc('transfer_household_ownership', {
        target_household_id: household.id,
        target_user_id: member.member_user_id,
      })
      if (error) throw error
      setInviteMessage('Propiedad del hogar transferida correctamente.')
      await refreshHouseholdManagement()
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo transferir la propiedad.')
    } finally {
      setInviteBusy(false)
    }
  }

  async function revokeHouseholdInvite(invitation: HouseholdInviteInfo) {
    if (!supabase || !window.confirm('¿Revocar este código? Ya no se podrá utilizar para entrar en el hogar.')) return
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { error } = await supabase.rpc('revoke_household_invite', { target_invite_id: invitation.invite_id })
      if (error) throw error
      setInviteMessage('Código de invitación revocado.')
      await refreshHouseholdManagement()
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'No se pudo revocar el código.')
    } finally {
      setInviteBusy(false)
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
      await refreshHouseholdManagement()
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
      detachCatalogReferences()
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

    const parsedPrice = price.trim() === '' ? null : Number(price.replace(',', '.'))
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) return
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
      catalogProductId: null,
      supermarket: firstEnabledStore,
      unitPrice: parsedPrice,
    }
    setItems((current) => {
      const existing = current.find((item) => canMergeShoppingItems(item, newItem))
      const next = existing
        ? current.map((item) => item.id === existing.id
          ? {
              ...item,
              quantity: item.quantity + newItem.quantity,
              note: item.note.trim() || newItem.note,
              catalogProductId: item.catalogProductId ?? newItem.catalogProductId,
              unitPrice: item.unitPrice ?? newItem.unitPrice,
              updatedAt: now,
            }
          : item)
        : [newItem, ...current]
      itemsRef.current = next
      return next
    })
    setName('')
    setQuantity('1')
    setUnit('ud.')
    setNote('')
    setPrice('')
    setMobileAddOpen(false)
  }


  async function addCatalogProductToList(product: CatalogProduct) {
    const now = Date.now()
    const format = product.format_quantity ? product.format_quantity + ' ' + product.format_unit : ''
    const details = [product.preferredBrand || product.brand, product.preferredFormat || format].filter(Boolean).join(' · ')
    let currentPrice: number | null = null
    if (supabase && isOnline) {
      const { data } = await supabase.rpc('search_shopping_product_suggestions', { p_query: product.name, p_zone: 'vlc1' })
      const matches = (data ?? []) as Array<{ supermarket: string; product_name: string; unit_price: number | string | null; price_box: Record<string, unknown> | null }>
      const match = matches.find((candidate) =>
        candidate.supermarket === selectedStore &&
        candidate.product_name.trim().toLocaleLowerCase('es') === product.name.trim().toLocaleLowerCase('es')
      )
      if (match) {
        const rawPrice = selectedStore === 'lidl' ? Number(match.price_box?.largePartNumeric) : match.unit_price === null ? NaN : Number(match.unit_price)
        currentPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null
      }
    }
    const newItem: ShoppingItem = {
      id: createItemId(),
      name: product.name,
      quantity: 1,
      unit: 'ud.',
      category: categories.includes(product.category) ? product.category : 'Otros',
      note: details,
      completed: false,
      createdAt: now,
      updatedAt: now,
      householdId: household.id,
      listId: list.id,
      deletedAt: null,
      catalogProductId: product.id,
      supermarket: selectedStore,
      unitPrice: currentPrice,
    }
    setItems((current) => {
      const existing = current.find((item) => canMergeShoppingItems(item, newItem))
      const next = existing
        ? current.map((item) => item.id === existing.id
          ? {
              ...item,
              quantity: item.quantity + newItem.quantity,
              note: item.note.trim() || newItem.note,
              catalogProductId: item.catalogProductId ?? newItem.catalogProductId,
              updatedAt: now,
            }
          : item)
        : [newItem, ...current]
      itemsRef.current = next
      return next
    })
    setCatalogScreenOpen(false)
    setFilter('Pendientes')
  }

  function addStoreProductToList(product: ProductSuggestion) {
    const now = Date.now()
    const itemId = createItemId()
    const parsedQuantity = Number(quantity)
    const selectedQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1
    const newItem: ShoppingItem = {
      id: itemId,
      name: product.name,
      quantity: selectedQuantity,
      unit: product.unit !== 'ud.' ? product.unit : unit.trim() || 'ud.',
      category: product.category,
      note: [product.note, note.trim()].filter(Boolean).join(' · '),
      completed: false,
      createdAt: now,
      updatedAt: now,
      householdId: household.id,
      listId: list.id,
      deletedAt: null,
      catalogProductId: null,
      supermarket: product.supermarket,
      unitPrice: product.priceNumber,
    }
    setItems((current) => {
      const existing = current.find((item) => canMergeShoppingItems(item, newItem))
      const next = existing
        ? current.map((item) => item.id === existing.id
          ? { ...item, quantity: item.quantity + selectedQuantity, note: item.note.trim() || newItem.note, unitPrice: item.unitPrice ?? newItem.unitPrice, updatedAt: now }
          : item)
        : [newItem, ...current]
      itemsRef.current = next
      return next
    })
    setSelectedStore(product.supermarket)
    setName('')
    setQuantity('1')
    setUnit('ud.')
    setNote('')
    setPrice('')
    setFilter('Pendientes')
    setMobileAddOpen(false)
    if (session && hasRemoteHousehold && !syncDisconnected) {
      setCatalogSaveFeedback('')
      setCatalogSavePrompt({ product, itemId })
    }
  }

  async function saveSelectedProductToCatalog() {
    const pending = catalogSavePrompt
    if (!pending || !supabase || !session || !hasRemoteHousehold || !isOnline) return
    setCatalogSaveBusy(true)
    setCatalogSaveFeedback('')
    try {
      const lookup = () => supabase
        .from('household_products')
        .select('id')
        .eq('household_id', household.id)
        .ilike('name', pending.product.name)
        .eq('brand', pending.product.brand)
        .is('archived_at', null)
        .limit(1)
        .maybeSingle()
      const { data: existing, error: lookupError } = await lookup()
      if (lookupError) throw lookupError
      let catalogId = existing?.id as string | undefined
      if (!catalogId) {
        const { data: inserted, error: insertError } = await supabase
          .from('household_products')
          .insert({
            household_id: household.id,
            created_by: session.user.id,
            name: pending.product.name,
            brand: pending.product.brand,
            category: pending.product.category,
            format_unit: 'ud.',
            notes: 'Guardado desde el buscador de ' + storeLabels[pending.product.supermarket],
          })
          .select('id')
          .single()
        if (insertError) {
          if (insertError.code !== '23505') throw insertError
          const { data: duplicate, error: duplicateError } = await lookup()
          if (duplicateError || !duplicate) throw duplicateError ?? insertError
          catalogId = duplicate.id
        } else {
          catalogId = inserted.id
        }
      }
      const savedAt = Date.now()
      setItems((current) => {
        const next = current.map((item) => item.id === pending.itemId
          ? { ...item, catalogProductId: catalogId ?? null, updatedAt: savedAt }
          : item)
        itemsRef.current = next
        return next
      })
      setCatalogSavePrompt(null)
    } catch (error) {
      setCatalogSaveFeedback(error instanceof Error ? error.message : 'No se pudo guardar en el catálogo.')
    } finally {
      setCatalogSaveBusy(false)
    }
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
      const next = current.map((item) => item.completed && !item.deletedAt && (item.supermarket ?? 'general') === selectedStore
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
            <button className="account-button" type="button" onClick={() => { setMarketPricesOpen(true); setLidlOffersOpen(false); setOptimizerOpen(false); setCatalogScreenOpen(false); setAccountScreenOpen(false) }}>💶 Precios</button>
            <button className="account-button" type="button" onClick={() => { setLidlOffersOpen(true); setMarketPricesOpen(false); setOptimizerOpen(false); setCatalogScreenOpen(false); setAccountScreenOpen(false) }}>🏷️ Lidl</button>
            <button className="account-button" type="button" onClick={() => { setOptimizerOpen(true); setLidlOffersOpen(false); setMarketPricesOpen(false); setCatalogScreenOpen(false); setAccountScreenOpen(false) }}>🧮 Mi cesta</button>
            {session && hasRemoteHousehold && !syncDisconnected && <button className="account-button" type="button" onClick={() => { setCatalogScreenOpen(true); setLidlOffersOpen(false); setMarketPricesOpen(false); setOptimizerOpen(false); setAccountScreenOpen(false) }}>📦 Catálogo</button>}
            <button className="account-button account-menu-trigger" type="button" aria-expanded={accountScreenOpen} onClick={() => { setLidlOffersOpen(false); setMarketPricesOpen(false); setOptimizerOpen(false); setCatalogScreenOpen(false); setAccountScreenOpen((open) => !open) }}>
              <span className={syncState === 'synced' && !syncPaused ? 'online-dot' : 'status-dot'} />
              <span className="account-menu-label">{accountScreenOpen ? 'Volver a la lista' : session ? household.name : 'Cuenta y sincronización'}</span>
              <span aria-hidden="true">{accountScreenOpen ? '←' : '⚙'}</span>
            </button>
          </div>
        </header>

        {catalogSavePrompt && (
          <div className="catalog-modal-backdrop" role="presentation" onClick={() => { if (!catalogSaveBusy) setCatalogSavePrompt(null) }}>
            <section className="catalog-modal catalog-favorite-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-favorite-title" onClick={(event) => event.stopPropagation()}>
              <p className="eyebrow">CATÁLOGO FAMILIAR</p>
              <h2 id="catalog-favorite-title">¿Guardar también este producto?</h2>
              <p className="auth-note"><strong>{catalogSavePrompt.product.name}</strong> ya se ha añadido a tu cesta. Si lo guardas, quedará como habitual del hogar para añadirlo más rápido la próxima vez.</p>
              <p className="auth-note">No guardamos el precio. Al añadirlo desde el catálogo consultaremos el precio vigente del supermercado seleccionado.</p>
              {catalogSaveFeedback && <p className="auth-feedback error">{catalogSaveFeedback}</p>}
              <div className="catalog-modal-actions">
                <button className="secondary-action" type="button" disabled={catalogSaveBusy} onClick={() => setCatalogSavePrompt(null)}>Ahora no</button>
                <button className="add-button" type="button" disabled={catalogSaveBusy || !isOnline} onClick={() => void saveSelectedProductToCatalog()}>{catalogSaveBusy ? 'Guardando…' : '☆ Guardar en catálogo'}</button>
              </div>
            </section>
          </div>
        )}
        {optimizerOpen ? (
          <BasketOptimizer items={activeItems.filter((item) => !item.completed)} householdId={household.id} online={isOnline} onBack={() => setOptimizerOpen(false)} />
        ) : marketPricesOpen ? (
          <MarketPrices onBack={() => setMarketPricesOpen(false)} />
        ) : lidlOffersOpen ? (
          <LidlOffers online={isOnline} onBack={() => setLidlOffersOpen(false)} />
        ) : catalogScreenOpen ? (
          session && hasRemoteHousehold && !syncDisconnected ? (
            <ProductCatalog householdId={household.id} userId={session.user.id} online={isOnline} onBack={() => setCatalogScreenOpen(false)} onAddToList={addCatalogProductToList} />
          ) : (
            <section className="account-page"><button className="back-to-list" type="button" onClick={() => setCatalogScreenOpen(false)}>← Volver a la lista</button><h1>Catálogo familiar</h1><p className="auth-note">Para usar el catálogo compartido, inicia sesión y conecta este dispositivo a un hogar.</p></section>
          )
        ) : accountScreenOpen ? (
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
                    {!syncDisconnected && <p className="auth-note">Los códigos caducan a los 7 días y admiten hasta 10 incorporaciones. Puedes revocar los que ya no necesites.</p>}
                  </section>
                  {!syncDisconnected && hasRemoteHousehold && (
                    <section className="account-page-card household-management-card">
                      <p className="field-label">MIEMBROS Y PERMISOS</p>
                      <h2>Personas de este hogar</h2>
                      <p className="auth-note">Los miembros pueden gestionar la lista y crear invitaciones. Solo el propietario puede retirar a otras personas o transferir la propiedad.</p>
                      {householdManagementBusy ? <p className="management-empty">Actualizando miembros e invitaciones…</p> : householdManagementError ? <p className="auth-feedback error" role="alert">{householdManagementError}</p> : householdMembers.length === 0 ? <p className="management-empty">No se han podido recuperar los miembros del hogar.</p> : (
                        <ul className="management-list">
                          {householdMembers.map((member) => (
                            <li className="management-row" key={member.member_user_id}>
                              <div className="management-person">
                                <strong>{member.member_email || 'Cuenta sin correo visible'}</strong>
                                <span>{member.member_role === 'owner' ? 'Propietario' : 'Miembro'} · Desde {new Date(member.member_joined_at).toLocaleDateString()}</span>
                              </div>
                              {member.member_role === 'owner' ? <span className="role-pill owner-role">Propietario</span> : isHouseholdOwner ? (
                                <div className="management-actions">
                                  <button type="button" className="management-link" disabled={inviteBusy} onClick={() => void transferHouseholdOwnership(member)}>Hacer propietario</button>
                                  <button type="button" className="management-remove" disabled={inviteBusy} onClick={() => void removeHouseholdMember(member)}>Retirar</button>
                                </div>
                              ) : <span className="role-pill">Miembro</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="management-subheading"><h3>Códigos de invitación</h3><span>{householdInvites.length}</span></div>
                      {householdInvites.length === 0 ? <p className="management-empty">Todavía no hay invitaciones creadas.</p> : (
                        <ul className="management-list invite-management-list">
                          {householdInvites.map((invitation) => {
                            const expired = Date.parse(invitation.expires_at) <= Date.now()
                            const revoked = Boolean(invitation.revoked_at)
                            const exhausted = invitation.use_count >= invitation.max_uses
                            const status = revoked ? 'Revocado' : expired ? 'Caducado' : exhausted ? 'Agotado' : 'Activo'
                            const canRevoke = !revoked && !expired && !exhausted && (invitation.created_by === session?.user.id || householdMembers.some((member) => member.member_user_id === session?.user.id && member.member_role === 'owner'))
                            return (
                              <li className="management-row" key={invitation.invite_id}>
                                <div className="management-person">
                                  <strong>{status} · {invitation.use_count}/{invitation.max_uses} usos</strong>
                                  <span>Caduca {new Date(invitation.expires_at).toLocaleDateString()} · Creado {new Date(invitation.created_at).toLocaleDateString()}</span>
                                </div>
                                {canRevoke && <button type="button" className="management-remove" disabled={inviteBusy} onClick={() => void revokeHouseholdInvite(invitation)}>Revocar</button>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {householdManagementError && <p className="auth-feedback error" role="alert">{householdManagementError}</p>}
                      {inviteMessage && <p className="auth-feedback" role="status">{inviteMessage}</p>}
                    </section>
                  )}
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
          {mobileAddOpen && <button type="button" className="mobile-sheet-backdrop" aria-label="Cerrar formulario de producto" onClick={() => setMobileAddOpen(false)} />}
          <section className={mobileAddOpen ? 'panel add-panel mobile-add-open' : 'panel add-panel'} role={mobileAddOpen ? 'dialog' : undefined} aria-modal={mobileAddOpen || undefined} aria-labelledby="add-product-title">
            <div className="panel-heading">
              <div><p className="eyebrow">AÑADIR A LA LISTA</p><h2 id="add-product-title">¿Qué hace falta?</h2></div>
              <button type="button" className="mobile-sheet-close" aria-label="Cerrar" onClick={() => setMobileAddOpen(false)}>×</button>
              <span className="heading-plus">＋</span>
            </div>
            <form onSubmit={addItem}>
              <label className="field-label" htmlFor="product-name">Producto</label>
              <ProductAutocomplete value={name} onChange={setName} onSelect={addStoreProductToList} disabled={!isReady || Boolean(storageError)} />
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
              <div className="price-field">
                <label className="field-label" htmlFor="product-price">Precio por unidad (€) <span className="optional">(opcional)</span></label>
                <input id="product-price" className="text-input" type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Se completa al elegir un producto" />
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
              <p className="autocomplete-fallback-note">Si no aparece en los catálogos, se añadirá como producto genérico a la primera lista activa: {storeLabels[firstEnabledStore]}.</p>
              <button className="add-button" type="submit" disabled={!isReady || Boolean(storageError) || !name.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || (price.trim() !== '' && (!Number.isFinite(Number(price.replace(',', '.'))) || Number(price.replace(',', '.')) < 0))}>Añadir como producto genérico <span>＋</span></button>
            </form>
          </section>

          <section className="panel list-panel">
            <div className="list-heading">
              <div><p className="eyebrow">LISTA POR SUPERMERCADO</p><h2>{storeLabels[selectedStore]} <span className="item-count">{storePendingCount}</span></h2></div>
              <div className="list-heading-actions">
                <span className="list-icon">🛒</span>
                <div className="export-control">
                  <button type="button" className="export-button" aria-label="Exportar lista" aria-expanded={exportMenuOpen} onClick={() => { setExportMenuOpen((open) => !open); setExportFeedback('') }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>
                  </button>
                  {exportMenuOpen && <div className="export-menu" role="menu" aria-label="Opciones de exportación">
                    <button type="button" role="menuitem" onClick={downloadShoppingPdf}>Guardar como PDF</button>
                    <button type="button" role="menuitem" onClick={() => void shareShoppingPdf()}>Compartir PDF</button>
                    <button type="button" role="menuitem" onClick={() => void shareShoppingText()}>Compartir como texto</button>
                    <button type="button" role="menuitem" onClick={async () => { try { await navigator.clipboard.writeText(exportText); setExportFeedback('Lista copiada al portapapeles.') } catch { setExportFeedback('No se pudo copiar el texto.') } setExportMenuOpen(false) }}>Copiar texto</button>
                  </div>}
                </div>
              </div>
              <button type="button" className="mobile-add-trigger" aria-haspopup="dialog" aria-expanded={mobileAddOpen} onClick={() => setMobileAddOpen(true)}><span>＋</span> Añadir producto</button>
            </div>
            {exportFeedback && <p className="export-feedback" role="status">{exportFeedback}</p>}
            <div className="store-tabs" role="tablist" aria-label="Listas de compra">
              {(['lidl', 'mercadona', 'general'] as ShoppingStore[]).map((store) => (
                <button key={store} type="button" role="tab" aria-selected={selectedStore === store} className={selectedStore === store ? 'store-tab active' : 'store-tab'} onClick={() => setSelectedStore(store)}>
                  <span className={'supermarket-mark ' + store}>{store === 'lidl' ? 'LIDL' : store === 'mercadona' ? 'M' : 'OTROS'}</span>
                  {storeLabels[store]}
                  <span className="store-tab-count">{activeItems.filter((item) => (item.supermarket ?? 'general') === store && !item.completed).length}</span>
                </button>
              ))}
            </div>
            <div className="list-total" aria-live="polite">
              <div><span>Total estimado</span><strong>{euroCurrency.format(storeEstimatedTotal)}</strong></div>
              <small>{storeMissingPriceCount > 0 ? `${storeMissingPriceCount} ${storeMissingPriceCount === 1 ? 'producto sin precio' : 'productos sin precio'} · el total es parcial` : 'Todos los productos tienen precio'}</small>
            </div>
            <div className="filter-tabs" role="tablist" aria-label="Filtrar productos">
              {(['Pendientes', 'Todo', 'Comprados'] as Filter[]).map((option) => (
                <button key={option} type="button" role="tab" aria-selected={filter === option} className={filter === option ? 'filter-tab active' : 'filter-tab'} onClick={() => setFilter(option)}>
                  {option}{option === 'Pendientes' && <span>{storePendingCount}</span>}
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
                    <div className="item-price">
                      {item.unitPrice != null && Number.isFinite(item.unitPrice)
                        ? <><strong>{euroCurrency.format(item.unitPrice * item.quantity)}</strong><small>{euroCurrency.format(item.unitPrice)} / {item.unit}</small></>
                        : <small>Sin precio</small>}
                    </div>
                    <button className="remove-button" type="button" onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {storeCompletedCount > 0 && <button className="clear-button" type="button" onClick={clearCompleted}>Retirar productos comprados</button>}
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
