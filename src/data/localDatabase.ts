import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { Household, ShoppingItem, ShoppingList } from '../domain/shopping'

type WorkspaceMetadata = {
  id: 'active'
  householdId: string
  householdName: string
  listId: string
  listName: string
  remote: boolean
}

type MiCompraDatabase = DBSchema & {
  households: { key: string; value: Household }
  householdMembers: { key: string; value: { id: string; householdId: string; displayName: string; role: 'owner' | 'member'; createdAt: number }; indexes: { 'by-household': string } }
  shoppingLists: { key: string; value: ShoppingList; indexes: { 'by-household': string } }
  shoppingItems: { key: string; value: ShoppingItem; indexes: { 'by-list': string; 'by-household': string } }
  workspaceMeta: { key: 'active'; value: WorkspaceMetadata }
}

const DATABASE_NAME = 'mi-compra-local'
const DATABASE_VERSION = 2
const DEFAULT_HOUSEHOLD_ID = 'household-local'
const DEFAULT_LIST_ID = 'shopping-list-default'
const LEGACY_STORAGE_KEY = 'mi-compra.shopping-items.v1'

let databasePromise: Promise<IDBPDatabase<MiCompraDatabase>> | undefined

function database() {
  databasePromise ??= openDB<MiCompraDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('households')) db.createObjectStore('households', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('householdMembers')) {
        const store = db.createObjectStore('householdMembers', { keyPath: 'id' })
        store.createIndex('by-household', 'householdId')
      }
      if (!db.objectStoreNames.contains('shoppingLists')) {
        const store = db.createObjectStore('shoppingLists', { keyPath: 'id' })
        store.createIndex('by-household', 'householdId')
      }
      if (!db.objectStoreNames.contains('shoppingItems')) {
        const store = db.createObjectStore('shoppingItems', { keyPath: 'id' })
        store.createIndex('by-list', 'listId')
        store.createIndex('by-household', 'householdId')
      }
      if (!db.objectStoreNames.contains('workspaceMeta')) {
        db.createObjectStore('workspaceMeta', { keyPath: 'id' })
      }
    },
  })
  return databasePromise
}

export async function loadLocalWorkspace(): Promise<{
  household: Household
  list: ShoppingList
  items: ShoppingItem[]
  remote: boolean
}> {
  try {
    const db = await database()
    const now = Date.now()
    let metadata = await db.get('workspaceMeta', 'active')
    if (!metadata) {
      metadata = {
        id: 'active',
        householdId: DEFAULT_HOUSEHOLD_ID,
        householdName: 'Mi casa',
        listId: DEFAULT_LIST_ID,
        listName: 'Lista de casa',
        remote: false,
      }
      await db.put('workspaceMeta', metadata)
    }

    let household = await db.get('households', metadata.householdId)
    if (!household) {
      household = { id: metadata.householdId, name: metadata.householdName, createdAt: now }
      await db.put('households', household)
    }

    let list = await db.get('shoppingLists', metadata.listId)
    if (!list) {
      list = { id: metadata.listId, householdId: household.id, name: metadata.listName, createdAt: now }
      await db.put('shoppingLists', list)
    }

    let items = await db.getAllFromIndex('shoppingItems', 'by-list', list.id)
    if (items.length === 0 && !metadata.remote) {
      const legacy = readLegacyItems()
      if (legacy.length > 0) {
        items = legacy.map((item) => ({
          ...item,
          householdId: household.id,
          listId: list.id,
          updatedAt: item.updatedAt ?? item.createdAt,
        }))
        const tx = db.transaction('shoppingItems', 'readwrite')
        await Promise.all([...items.map((item) => tx.store.put(item)), tx.done])
        try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* La copia ya está en IndexedDB. */ }
      }
    }

    return { household, list, items, remote: metadata.remote }
  } catch {
    const now = Date.now()
    const household: Household = { id: DEFAULT_HOUSEHOLD_ID, name: 'Mi casa', createdAt: now }
    const list: ShoppingList = { id: DEFAULT_LIST_ID, householdId: household.id, name: 'Lista de casa', createdAt: now }
    return {
      household,
      list,
      items: readLegacyItems().map((item) => ({
        ...item,
        householdId: household.id,
        listId: list.id,
        updatedAt: item.updatedAt ?? item.createdAt,
      })),
      remote: false,
    }
  }
}

function readLegacyItems(): ShoppingItem[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ShoppingItem =>
      typeof item === 'object' && item !== null &&
      typeof (item as ShoppingItem).id === 'string' &&
      typeof (item as ShoppingItem).name === 'string' &&
      typeof (item as ShoppingItem).createdAt === 'number'
    ).map((item) => ({
      ...item,
      householdId: DEFAULT_HOUSEHOLD_ID,
      listId: DEFAULT_LIST_ID,
      updatedAt: item.updatedAt ?? item.createdAt,
    }))
  } catch {
    return []
  }
}

export async function saveActiveWorkspace(
  household: Household,
  list: ShoppingList,
  remote: boolean,
): Promise<void> {
  const db = await database()
  const tx = db.transaction(['households', 'shoppingLists', 'workspaceMeta'], 'readwrite')
  await Promise.all([
    tx.objectStore('households').put(household),
    tx.objectStore('shoppingLists').put(list),
    tx.objectStore('workspaceMeta').put({
      id: 'active',
      householdId: household.id,
      householdName: household.name,
      listId: list.id,
      listName: list.name,
      remote,
    }),
    tx.done,
  ])
}

export async function saveLocalItems(listId: string, items: ShoppingItem[]): Promise<void> {
  try {
    const db = await database()
    const tx = db.transaction('shoppingItems', 'readwrite')
    const existingKeys = await tx.store.index('by-list').getAllKeys(listId)
    await Promise.all([
      ...existingKeys.map((key) => tx.store.delete(key)),
      ...items.map((item) => tx.store.put(item)),
      tx.done,
    ])
  } catch {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(items))
  }
}
