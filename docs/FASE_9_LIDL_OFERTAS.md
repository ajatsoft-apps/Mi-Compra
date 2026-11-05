# Fase 9 — Ofertas semanales Lidl privadas

## Estado de la integración

- La API pública de tiendas Lidl España y el endpoint de ofertas semanales se han probado mediante peticiones HTTP normales.
- El importador consulta exclusivamente las tiendas configuradas y escribe en un único hogar indicado por el secreto `LIDL_HOUSEHOLD_ID`.
- El esquema se ha aplicado a Supabase en la migración `lidl_weekly_offers`.
- La PWA incorpora una pantalla privada de ofertas Lidl para usuarios autenticados del hogar.
- El workflow permite ejecución manual y está programado lunes y viernes a las 07:00 UTC.
- La integración no modifica las tablas ni el importador OpenCesta/Mercadona.

## Configuración requerida en GitHub Actions

En `Settings → Secrets and variables → Actions` del repositorio deben existir estos secretos:

- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave service role; nunca se incorpora al frontend.
- `LIDL_HOUSEHOLD_ID`: UUID del único hogar que recibirá las ofertas. No usar una lista de hogares ni el UUID de otro hogar.

El workflow falla de forma cerrada si falta el UUID, no corresponde a un hogar existente, la API devuelve una tienda desconocida, no hay ofertas válidas, hay IDs duplicados o Supabase no confirma el número importado.

Tiendas configuradas inicialmente para Castellón:
- `ES0375` · Castellón-Castalia
- `ES0380` · Castellón-Avda. Valencia
- `ES0385` · Castellón-Avda. del Mar

El CP 12006 no tuvo coincidencia exacta en el catálogo consultado; se usan tiendas de la misma localidad, no se afirma que sean la tienda más cercana.

## Modelo y seguridad

- `lidl_offer_snapshots`: captura por hogar, tienda y fecha.
- `lidl_offer_observations`: ofertas, fechas de vigencia, canal, tipo, IDs internos y `price_box` original.
- RLS activa en ambas tablas.
- Lectura solo para usuarios autenticados miembros del hogar mediante `private.is_household_member`.
- Sin permisos para `anon`.
- RPC de publicación ejecutable solo por `service_role`.
- Retención de snapshots superior a 90 días eliminada al publicar una captura nueva para la misma tienda y hogar.
- La publicación sustituye atómicamente el contenido de la captura diaria.
- El importador valida el hogar de destino antes de consultar y publicar; nunca enumera ni replica a todos los hogares.

## Límites que se mantienen deliberadamente

- No es un catálogo completo de alimentación Lidl.
- No se inventa un EAN: `productIds` son IDs internos de Lidl.
- No se convierte automáticamente `priceBox` en precio final: puede representar descuentos porcentuales o promociones por varias unidades.
- No se afirma que haya stock en tienda.
- No se comparan automáticamente ofertas con productos Mercadona. Para ello hará falta una vinculación exacta o confirmación manual de variante y condiciones.
- El texto de precio se muestra como texto original de Lidl, no como precio unitario normalizado.
- La pantalla de ofertas solo se muestra dentro de un hogar autenticado; no se publica el contenido en una vista pública.

## Prueba de funcionamiento

1. Configurar los tres secretos indicados arriba.
2. Ejecutar manualmente `Import Lidl weekly offers`.
3. Comprobar que el job informa del número de ofertas importadas por tienda.
4. Abrir Mi Compra con una cuenta miembro del hogar configurado y entrar en `Lidl`.
5. Confirmar que aparecen las tiendas, las fechas y las ofertas.
6. Comprobar desde otra cuenta de otro hogar que no ve esas filas.

La programación automática solo funcionará cuando los secretos estén configurados. La primera ejecución manual debe completarse antes de dar la integración por validada en uso real.

## Fuente técnica

- API de tiendas: `https://stores.lidlplus.com/api/v4/ES`
- API de ofertas: `https://offers.lidlplus.com/app/api/v4/ES/{STORE_KEY}/offers`
- Referencia comunitaria de los endpoints: https://github.com/FaserF/ha-lidl
