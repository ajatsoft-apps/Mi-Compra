import type { User } from '@supabase/supabase-js'
import { saveActiveWorkspace, saveLocalItems } from './localDatabase'
import { supabase } from './supabaseClient'
import type { Category, Household, ShoppingItem, ShoppingList } from '../domain/shopping'

type RemoteItem = {
  id: string
  household_id: string
  list_id: string
  product_name: string
  quantity: number | string
  unit: string
  category: string
  note: string
  is_completed: boolean
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  deleted_at: string | null
}

const categories: Category[] = ['Fruta y verdura', 'Lácteos', 'Despensa', 'Bebidas', 'Hogar', 'Otros']

function toTimestamp(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toLocalItem(row: RemoteItem): ShoppingItem {
  const createdAt = toTimestamp(row.created_at, Date.now())
  return {
    id: row.id,
    householdId: row.household_id,
    listId: row.list_id,
    name: row.product_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    category: categories.includes(row.category as Category) ? row.category as Category : 'Otros',
    note: row.note ?? '',
    completed: row.is_completed,
    createdAt,
    updatedAt: toTimestamp(row.updated_at, createdAt),
    deletedAt: row.deleted_at ? toTimestamp(row.deleted_at, Date.now()) : null,
  }
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  throw new Error('Este navegador no permite generar identificadores seguros. Abre Mi Compra en un contexto HTTPS actualizado.')
}

export async function synchronizeWorkspace(
  user: User,
  localHousehold: Household,
  localList: ShoppingList,
  localItems: ShoppingItem[],
): Promise<{ household: Household; list: ShoppingList; items: ShoppingItem[]; idRemap: Record<string, string> }> {
  if (!supabase) throw new Error('Supabase no está configurado en esta instalación.')
  const client = supabase

  const hasSelectedRemoteHousehold = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localHousehold.id)
  const membershipResult = hasSelectedRemoteHousehold
    ? await client
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', user.id)
      .eq('household_id', localHousehold.id)
      .maybeSingle()
    : await client
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  const { data: membership, error: membershipError } = membershipResult
  if (membershipError) throw membershipError
  if (hasSelectedRemoteHousehold && !membership) {
    throw new Error('HOUSEHOLD_MEMBERSHIP_REVOKED: Esta cuenta ya no pertenece al hogar seleccionado.')
  }

  let household: Household
  if (membership?.household_id) {
    const { data, error } = await client
      .from('households')
      .select('id, name, created_at')
      .eq('id', membership.household_id)
      .single()
    if (error) throw error
    household = {
      id: data.id,
      name: data.name,
      createdAt: toTimestamp(data.created_at, Date.now()),
    }
  } else {
    const { data: householdId, error } = await client.rpc('create_household', {
      household_name: localHousehold.name || 'Mi casa',
    })
    if (error) throw error
    const { data, error: readError } = await client
      .from('households')
      .select('id, name, created_at')
      .eq('id', householdId)
      .single()
    if (readError) throw readError
    household = {
      id: data.id,
      name: data.name,
      createdAt: toTimestamp(data.created_at, Date.now()),
    }
  }

  const { data: existingList, error: listError } = await client
    .from('shopping_lists')
    .select('id, household_id, name, created_at')
    .eq('household_id', household.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (listError) throw listError

  let list: ShoppingList
  if (existingList) {
    list = {
      id: existingList.id,
      householdId: existingList.household_id,
      name: existingList.name,
      createdAt: toTimestamp(existingList.created_at, Date.now()),
    }
  } else {
    const { data, error } = await client
      .from('shopping_lists')
      .insert({
        household_id: household.id,
        name: localList.name || 'Lista de casa',
        created_by: user.id,
      })
      .select('id, household_id, name, created_at')
      .single()
    if (error) throw error
    list = {
      id: data.id,
      householdId: data.household_id,
      name: data.name,
      createdAt: toTimestamp(data.created_at, Date.now()),
    }
  }

  const { data: remoteBefore, error: readItemsError } = await client
    .from('shopping_list_items')
    .select('id, household_id, list_id, product_name, quantity, unit, category, note, is_completed, created_by, updated_by, created_at, updated_at, completed_at, deleted_at')
    .eq('list_id', list.id)
  if (readItemsError) throw readItemsError

  const remoteById = new Map((remoteBefore as RemoteItem[]).map((item) => [item.id, item]))
  const pendingWrites: Record<string, unknown>[] = []
  const idRemap: Record<string, string> = {}

  for (const sourceItem of localItems) {
    const remote = remoteById.get(sourceItem.id)
    const itemId = remote ? sourceItem.id : newLocalId()
    if (itemId !== sourceItem.id) idRemap[sourceItem.id] = itemId
    const item: ShoppingItem = {
      ...sourceItem,
      id: itemId,
      householdId: household.id,
      listId: list.id,
    }
    const localIsNewer = !remote || item.updatedAt > toTimestamp(remote.updated_at, 0)
    if (!localIsNewer) continue

    pendingWrites.push({
      id: item.id,
      household_id: household.id,
      list_id: list.id,
      product_name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      note: item.note,
      is_completed: item.completed,
      created_by: remote?.created_by ?? user.id,
      updated_by: user.id,
      created_at: remote?.created_at ?? new Date(item.createdAt).toISOString(),
      updated_at: new Date(item.updatedAt).toISOString(),
      deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    })
  }

  if (pendingWrites.length > 0) {
    const { error } = await client
      .from('shopping_list_items')
      .upsert(pendingWrites, { onConflict: 'id' })
    if (error) throw error
  }

  const { data: remoteAfter, error: finalReadError } = await client
    .from('shopping_list_items')
    .select('id, household_id, list_id, product_name, quantity, unit, category, note, is_completed, created_by, updated_by, created_at, updated_at, completed_at, deleted_at')
    .eq('list_id', list.id)
    .order('created_at', { ascending: false })
  if (finalReadError) throw finalReadError

  const mergedItems = (remoteAfter as RemoteItem[]).map(toLocalItem)
  await saveActiveWorkspace(household, list, true)
  await saveLocalItems(list.id, mergedItems)

  return { household, list, items: mergedItems, idRemap }
}

export async function pullRemoteItems(listId: string): Promise<ShoppingItem[]> {
  if (!supabase) throw new Error('Supabase no está configurado en esta instalación.')
  const { data, error } = await supabase
    .from('shopping_list_items')
    .select('id, household_id, list_id, product_name, quantity, unit, category, note, is_completed, created_by, updated_by, created_at, updated_at, completed_at, deleted_at')
    .eq('list_id', listId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as RemoteItem[]).map(toLocalItem)
}
