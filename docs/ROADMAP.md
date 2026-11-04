# Hoja de ruta

## Fase 1 — Análisis funcional

Cerrada. Definidos el uso familiar, la lista compartida, preferencias, aprendizaje prudente y objetivos de optimización.

## Fase 2 — Viabilidad y arquitectura

Cerrada. React + TypeScript, Vite, PWA, Supabase, PostgreSQL, RLS, Realtime e IndexedDB como arquitectura prevista. Las fuentes de precios se incorporarán de forma gradual y verificable.

## Fase 3 — Proyecto y estructura inicial

Cerrada. Estructura React/TypeScript/Vite y PWA creadas. La compilación de producción y la comprobación de tipos han superado GitHub Actions.

## Fase 4 — Primera base funcional

En curso.

- [x] Pantalla inicial de la lista de compra.
- [x] Añadir productos con cantidad, unidad, categoría y nota.
- [x] Marcar productos como comprados y retirarlos de la lista.
- [x] Filtros de pendientes, todos y comprados.
- [x] Guardado local entre sesiones con IndexedDB y respaldo/migración desde `localStorage`.
- [x] Modelo de datos local para hogar, miembros, listas y productos.
- [x] Primera migración SQL de Supabase con políticas RLS para aislar los datos de cada hogar.
- [x] Interfaz adaptable a móvil, tablet y escritorio.
- [ ] Pruebas funcionales y revisión de accesibilidad.
- [ ] Configurar un proyecto Supabase y aplicar/verificar la migración SQL.
- [ ] Registro/inicio de sesión e invitación segura de familiares.
- [ ] Sincronización real entre dispositivos mediante backend.

## Fase 5 — Backend y sincronización

Pendiente: proyecto Supabase, esquema SQL, RLS, autenticación familiar y Realtime. La sincronización entre miembros no se simula en el cliente.

## Fase 6 — Catálogo, preferencias y compras

Pendiente: productos, formatos, equivalencias, preferencias y registro de compras.

## Fase 7 — Fuentes de precios y promociones

Pendiente: adaptadores por cadena, trazabilidad, vigencia y calidad de datos.

## Fase 8 — Comparador y optimizador

Pendiente: reglas deterministas, umbrales de ahorro, promociones condicionadas y costes de desplazamiento.

## Fase 9 — Voz, notificaciones y pruebas

Pendiente: evaluar capacidades reales por plataforma, accesibilidad, offline y pruebas con la familia.
