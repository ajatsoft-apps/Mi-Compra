export type Category = 'Fruta y verdura' | 'Lácteos' | 'Despensa' | 'Bebidas' | 'Hogar' | 'Otros'

export type ShoppingItem = {
  id: string
  householdId: string
  listId: string
  name: string
  quantity: number
  unit: string
  category: Category
  note: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

export type Household = {
  id: string
  name: string
  createdAt: number
}

export type HouseholdMember = {
  id: string
  householdId: string
  displayName: string
  role: 'owner' | 'member'
  createdAt: number
}

export type ShoppingList = {
  id: string
  householdId: string
  name: string
  createdAt: number
}
