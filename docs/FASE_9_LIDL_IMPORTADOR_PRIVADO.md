# Fase 9 — Lidl: ofertas semanales privadas

## Estado de esta entrega

Esta rama añade el diseño de almacenamiento aislado y el importador, pero **no aplica el esquema a Supabase ni despliega la PWA**.

Archivos:
- `supabase/lidl_offers_schema.sql`: SQL de diseño para tablas, RLS y publicación atómica.
- `scripts/import_lidl_weekly_offers.py`: importador de lectura de la API de Lidl y escritura mediante RPC de Supabase.
- `.github/workflows/import-lidl-offers.yml`: ejecución manual, sin programación automática.

El SQL se mantiene como archivo de diseño y no como migración aplicada. Antes de convertirlo en migración debe generarse el archivo con `supabase migration new` desde el entorno local, revisar el diff y probarlo en una base de desarrollo. No ejecutar directamente sobre producción en esta fase.

## Modelo de datos

Se usan dos tablas independientes de `market_price_*`:

- `lidl_offer_snapshots`: captura por hogar, tienda y día, con procedencia, fecha y número de ofertas.
- `lidl_offer_observations`: ofertas y sus campos de vigencia, canal, tipo, imagen y `priceBox` original.

Ambas tablas tienen RLS. Los usuarios autenticados solo pueden leer filas cuyo `household_id` pertenezca a un hogar del que sean miembros mediante `private.is_household_member`. No se concede lectura a `anon`. La RPC de publicación solo se concede a `service_role` y reemplaza el contenido de una captura de forma atómica.

Los `productIds` de Lidl se guardan como identificadores internos. No se convierten ni se presentan como EAN. El precio original se conserva en `price_box` porque los descuentos porcentuales, por varias unidades y las promociones sin importe final no se pueden normalizar de forma segura en todos los casos.

## Importador

El importador:
1. Lee el catálogo de tiendas de España.
2. Solo consulta las tiendas incluidas explícitamente en `LIDL_STORE_KEYS`.
3. Lee hogares de Supabase con la clave de servicio, sin descargar datos de listas ni productos.
4. Publica cada captura para cada hogar a través de `publish_lidl_offer_snapshot`.
5. Rechaza respuestas vacías, ofertas sin ID/título, más de 500 ofertas y tiendas desconocidas.

No utiliza cuentas Lidl Plus, credenciales, cookies, tokens, fingerprinting, proxies ni técnicas para sortear bloqueos. Si el endpoint deja de responder o devuelve error, el proceso falla sin publicar una captura vacía.

## Preparación pendiente antes de ejecutar

1. Revisar el marco legal/contractual de uso de la fuente. La disponibilidad técnica del endpoint no equivale a autorización para almacenar o redistribuir contenidos.
2. Crear una migración local con Supabase CLI a partir de `supabase/lidl_offers_schema.sql`, revisarla y probarla en una base de desarrollo.
3. Ejecutar pruebas RLS con dos hogares y usuarios distintos: un miembro debe leer su hogar y no el ajeno; un usuario anónimo no debe leer ninguna oferta.
4. Aplicar la migración solo después de superar esas pruebas y autorizar expresamente el cambio de base de datos.
5. Configurar los secretos de GitHub `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
6. Ejecutar manualmente **Import Lidl weekly offers (manual)** con las tiendas que se quieran consultar.

La ejecución manual evita automatizar llamadas a un endpoint interno antes de comprobar estabilidad, frecuencia adecuada y condiciones de uso.

## Límites funcionales

- No se integra todavía con el optimizador de cesta.
- No se compara por similitud de nombres.
- No se infieren EAN a partir de `productIds`.
- No se calcula un precio unitario cuando Lidl no proporciona datos suficientes.
- No se garantiza disponibilidad o stock en tienda.
- La consulta es por tienda; no equivale a un catálogo completo de Lidl.
- Las imágenes y contenidos de Lidl no deben exponerse públicamente sin autorización.

## Prueba de origen

La prueba técnica anterior está documentada en [PR #12](https://github.com/ajatsoft-apps/Mi-Compra/pull/12) y en el informe incluido en ese PR. Se observaron 31 ofertas por tienda en las tres tiendas consultadas de Castellón, sin EAN explícitos en la muestra.
