# Arquitectura inicial

## Objetivo

Aplicación PWA privada para organizar la compra familiar, sincronizar una lista compartida y ayudar a decidir dónde comprar cada producto sin presentar estimaciones como precios reales.

## Cliente

- React + TypeScript + Vite.
- `package-lock.json` versionado; CI utiliza `npm ci` para instalaciones reproducibles.
- Tailwind CSS para estilos.
- Zustand para estado local de interfaz y flujos cliente.
- TanStack Query para consultas, caché y sincronización con servicios.
- IndexedDB (mediante `idb`) como base local para la experiencia offline, con metadatos del hogar/lista activa y marcas de borrado sincronizables.
- Modelo local separado para hogares, miembros, listas y productos; los registros de compra incluyen `householdId` y `listId` desde el inicio.
- Migración automática de los datos antiguos de `localStorage` a IndexedDB, manteniendo una copia de respaldo si IndexedDB no está disponible.
- `vite-plugin-pwa` para instalación y service worker.

## Backend previsto

Supabase con PostgreSQL, Auth y Realtime. Las migraciones versionadas crean hogares, miembros, listas y productos, con aislamiento por hogar mediante RLS. Las funciones privilegiadas viven en el esquema privado `private`; la única RPC pública de creación de hogar es un wrapper SECURITY INVOKER. El cliente usa una clave publishable y nunca incluye claves privilegiadas.

## Autenticación y sincronización

- Acceso por correo y contraseña mediante Supabase Auth; el registro respeta la confirmación de correo configurada en el proyecto.
- La sesión se restaura desde el almacenamiento seguro gestionado por supabase-js.
- IndexedDB es la fuente inmediata de lectura/escritura; las operaciones locales no esperan a la red.
- Tras iniciar sesión, se crea o recupera el hogar del usuario, se obtiene su lista y se fusionan cambios por UUID y marca temporal.
- Los borrados se representan como tombstones `deleted_at` para propagarse entre dispositivos y evitar resurrecciones simples.
- Realtime avisa de cambios remotos; al reconectar se vuelve a ejecutar la sincronización.
- Conflictos simultáneos se resuelven por última marca `updated_at` (last-write-wins). No es un historial de versiones ni una resolución semántica.

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
