# Hoja de ruta

## Fase 1 — Análisis funcional

Cerrada. Definidos el uso familiar, la lista compartida, preferencias, aprendizaje prudente y objetivos de optimización.

## Fase 2 — Viabilidad y arquitectura

Cerrada. React + TypeScript, Vite, PWA, Supabase, PostgreSQL, RLS, Realtime e IndexedDB como arquitectura prevista. Las fuentes de precios se incorporarán de forma gradual y verificable.

## Fase 3 — Proyecto y estructura inicial

Cerrada. Estructura React/TypeScript/Vite y PWA creadas. La compilación de producción y la comprobación de tipos han superado GitHub Actions.

## Fase 4 — Primera base funcional

Cerrada a nivel de código y compilación.

- [x] Pantalla inicial de la lista de compra.
- [x] Añadir productos con cantidad, unidad, categoría y nota.
- [x] Marcar productos como comprados y retirarlos de la lista.
- [x] Filtros de pendientes, todos y comprados.
- [x] Guardado local con IndexedDB y migración/respaldo desde `localStorage`.
- [x] Modelo local de hogares, miembros, listas y productos.
- [x] Migración SQL inicial de Supabase con políticas RLS y controles de pertenencia.
- [x] PWA con icono de instalación para iOS.
- [x] Compilación de producción y auditoría de dependencias de producción superadas en GitHub Actions.
- [ ] Pruebas manuales de uso en móviles y tablets (se completarán en la fase de pruebas).

**Límite actual:** la lista todavía se guarda en el dispositivo. La sincronización entre familiares no está activada hasta configurar Supabase y autenticación.

## Fase 5 — Backend y sincronización

En curso. Cliente Supabase preparado y documentación de conexión creada. Falta conectar el proyecto, aplicar y validar la migración SQL, definir autenticación familiar, invitaciones y sincronización Realtime. Requiere la URL y la clave pública anon/publishable del proyecto. Nunca se solicitará ni almacenará una clave `service_role` en el cliente.

## Fase 6 — Catálogo, preferencias y compras

Pendiente: productos, formatos, equivalencias, preferencias y registro de compras.

## Fase 7 — Fuentes de precios y promociones

Pendiente: adaptadores por cadena, trazabilidad, vigencia y calidad de datos.

## Fase 8 — Comparador y optimizador

Pendiente: reglas deterministas, umbrales de ahorro, promociones condicionadas y costes de desplazamiento.

## Fase 9 — Voz, notificaciones y pruebas

Pendiente: evaluar capacidades reales por plataforma, accesibilidad, offline y pruebas con la familia.
