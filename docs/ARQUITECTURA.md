# Arquitectura inicial

## Objetivo

Aplicación PWA privada para organizar la compra familiar, sincronizar una lista compartida y ayudar a decidir dónde comprar cada producto sin presentar estimaciones como precios reales.

## Cliente

- React + TypeScript + Vite.
- Tailwind CSS para estilos.
- Zustand para estado local de interfaz y flujos cliente.
- TanStack Query para consultas, caché y sincronización con servicios.
- IndexedDB (mediante `idb`) como base local para la experiencia offline.
- Modelo local separado para hogares, miembros, listas y productos; los registros de compra incluyen `householdId` y `listId` desde el inicio.
- Migración automática de los datos antiguos de `localStorage` a IndexedDB, manteniendo una copia de respaldo si IndexedDB no está disponible.
- `vite-plugin-pwa` para instalación y service worker.

## Backend previsto

Supabase con PostgreSQL, Auth y Realtime. El esquema inicial está definido en `supabase/migrations/202611040001_households_shopping.sql`: hogares, miembros, listas y productos, con aislamiento por hogar mediante Row Level Security (RLS). La migración está preparada, pero todavía no se ha aplicado a un proyecto Supabase. Las claves privilegiadas nunca estarán en el bundle del navegador.

## Dominios funcionales

1. Familia, miembros y permisos.
2. Listas compartidas e historial de cambios.
3. Catálogo de productos, códigos EAN y formatos.
4. Equivalencias y alternativas aceptadas.
5. Preferencias de compra por hogar y producto.
6. Cadenas y establecimientos.
7. Observaciones de precios y promociones.
8. Comparador y optimizador determinista.
9. Historial de compras y aprendizaje supervisado por decisiones repetidas.
10. Voz, notificaciones y ajustes.

## Regla de calidad de datos

Cada precio debe conservar importe, unidad de medida, fecha de observación, fuente, ámbito geográfico/establecimiento y nivel de confianza. Un precio ausente o caducado no se sustituye por una estimación silenciosa.

## Integraciones comerciales

Cada cadena tendrá un adaptador desacoplado. La aplicación distinguirá datos de catálogo, precios, disponibilidad y promociones. No se presupone que exista una API pública estable para todas las cadenas; cada fuente se validará antes de automatizarla.

## Motor de comparación

La IA podrá interpretar texto, proponer categorías y detectar posibles equivalencias. Los cálculos de precio unitario, descuentos, mínimos, coste de desplazamiento y ahorro serán reglas deterministas y explicables.

## Seguridad y privacidad

- Acceso familiar aislado mediante RLS.
- Secretos solo en backend/entorno seguro.
- Variables públicas del cliente limitadas a URL y clave anon/publishable de Supabase.
- No almacenar credenciales de supermercados.
- Minimizar los datos personales recogidos.
