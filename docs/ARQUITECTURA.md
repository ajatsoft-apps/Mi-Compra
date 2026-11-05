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

Supabase con PostgreSQL, Auth y Realtime. Las migraciones versionadas crean hogares, miembros, listas y productos, con aislamiento por hogar mediante RLS. Las funciones privilegiadas viven en el esquema privado `private`; las RPC públicas son wrappers SECURITY INVOKER y delegan en funciones SECURITY DEFINER que validan explícitamente la identidad, la pertenencia y el rol. El cliente usa una clave publishable y nunca incluye claves privilegiadas.

## Autenticación y sincronización

- Acceso por correo y contraseña mediante Supabase Auth; el registro respeta la confirmación de correo configurada en el proyecto.
- La sesión se restaura desde el almacenamiento seguro gestionado por supabase-js.
- IndexedDB es la fuente inmediata de lectura/escritura; las operaciones locales no esperan a la red.
- Tras iniciar sesión, se crea o recupera el hogar del usuario, se obtiene su lista y se fusionan cambios por UUID y marca temporal.
- Los borrados se representan como tombstones `deleted_at` para propagarse entre dispositivos y evitar resurrecciones simples.
- Realtime avisa de cambios remotos; al reconectar se vuelve a ejecutar la sincronización.
- Conflictos simultáneos se resuelven por última marca `updated_at` (last-write-wins). No es un historial de versiones ni una resolución semántica.
- Cada dispositivo mantiene un hogar activo; la base de datos permite que una cuenta pertenezca a más de un hogar, pero todavía no hay selector visual de hogares.

## Gestión familiar

- Los códigos de invitación contienen 192 bits aleatorios; solo se guarda su hash SHA-256. Caducan a los 7 días y permiten hasta 10 incorporaciones.
- La RPC de miembros devuelve correo, rol y fecha de alta solo a miembros autenticados del hogar solicitado.
- Los miembros pueden crear invitaciones. El creador puede revocar sus propios códigos y el propietario puede revocar cualquiera.
- Solo el propietario puede retirar a otros miembros o transferir la propiedad. Retirar a alguien revoca también sus invitaciones activas.
- Al transferir la propiedad, el propietario anterior permanece como miembro. Si el propietario abandona el hogar sin transferirlo manualmente, la función de salida asigna la propiedad al miembro más antiguo.
- La revocación de acceso se aplica en el servidor mediante RLS y las RPC. Los datos que ya se descargaron pueden permanecer en el almacenamiento local del dispositivo retirado; no existe borrado remoto de cachés locales.

## Catálogo, preferencias y compras

- `household_products` identifica productos por hogar, con marca, código de barras, contenido del envase, unidad, categoría y notas. Los productos se archivan en vez de borrarse para conservar referencias e historial.
- `shopping_list_items.catalog_product_id` enlaza una línea de compra con el producto de catálogo del mismo hogar mediante clave foránea compuesta.
- `household_product_preferences` guarda marca y formato preferidos y si se aceptan sustitutos.
- `household_product_equivalences` conserva relaciones explícitas entre productos (`same_product` o `accepted_substitute`). No se deducen equivalencias por similitud del nombre.
- `purchase_history` guarda una instantánea del nombre, marca y formato junto con cantidad, precio pagado, establecimiento y fecha. Es un registro histórico del precio pagado, no un precio vigente de tienda.
- Las cuatro tablas están protegidas por RLS y se publican en Realtime. La caché del catálogo en el navegador permite consultar productos conocidos sin conexión; las mutaciones del catálogo y el registro de compras requieren conexión.

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

Cada cadena tendrá un adaptador desacoplado. La aplicación distinguirá datos de catálogo, precios, disponibilidad y promociones. No se presupone que exista una API pública estable para todas las cadenas; cada fuente se validará antes de automatizarla. Los endpoints internos no documentados de una tienda no se tratarán como API autorizada por el mero hecho de responder sin autenticación. La integración automática de Mercadona queda bloqueada hasta confirmar permiso o disponer de un feed reutilizable.

## Fuentes de precios y promociones

Los datos externos se incorporan mediante adaptadores independientes, uno por fuente. La fuente conserva su identificador, URL, licencia, atribución, fecha de importación y estado. Cada observación de precio conserva el producto exacto o la categoría genérica, importe, unidad de referencia, moneda, establecimiento o zona, fecha de observación, vigencia, tipo de precio y condiciones de promoción.

No se equipara una media de categoría con el precio de una referencia concreta. No se mezclan precios de zonas diferentes. Las promociones condicionadas (tarjeta, cantidad mínima, segunda unidad, packs) se almacenan como condiciones explícitas, no como un precio unitario engañoso. Los datos caducados se conservan para histórico, pero no se presentan como vigentes.

Las fuentes con licencias incompatibles con el modelo de distribución se mantienen fuera del conjunto integrado hasta resolver sus obligaciones de atribución y compartir derivados. La evaluación y cobertura conocida se documenta en `docs/FUENTES_PRECIOS.md`. La primera integración usa snapshots de OpenCesta (ODbL-1.0) en tablas públicas separadas: `market_price_snapshots` y `market_price_observations`. `market_price_staging` recibe las cargas y una RPC transaccional publica solo snapshots completos. La PWA consulta la última captura; el importador diario descarga el Parquet de la release upstream y conserva 180 días de histórico. El secreto service-role solo existe en GitHub Actions, nunca en el cliente.

## Motor de comparación

La IA podrá interpretar texto, proponer categorías y detectar posibles equivalencias. Los cálculos de precio unitario, descuentos, mínimos, coste de desplazamiento y ahorro serán reglas deterministas y explicables.

## Seguridad y privacidad

- Acceso familiar aislado mediante RLS.
- Secretos solo en backend/entorno seguro.
- Variables públicas del cliente limitadas a URL y clave anon/publishable de Supabase.
- No almacenar credenciales de supermercados.
- Minimizar los datos personales recogidos.
