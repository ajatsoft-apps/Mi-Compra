# Ofertas Lidl globales en Mi Compra

## Modelo de uso

Las ofertas Lidl pertenecen al catálogo común de la aplicación, no a un hogar. Cualquier persona que abra la PWA puede consultarlas, incluso sin iniciar sesión, sin crear hogar y sin unirse a una lista familiar.

Los hogares solo se utilizan para compartir listas y catálogo familiar. No participan en la importación, almacenamiento ni lectura de ofertas Lidl.

## Importación

El workflow consulta tiendas y ofertas de Lidl Plus España y publica los snapshots en Supabase mediante una RPC de service role. No necesita UUID de hogar ni secreto `LIDL_HOUSEHOLD_ID`.

Secretos/configuración:
- `VITE_SUPABASE_URL` como repository variable o secret.
- `SUPABASE_SERVICE_ROLE_KEY` como repository secret.
- Tiendas iniciales: ES0375, ES0380 y ES0385 (Castellón).

Se ejecuta manualmente o lunes y viernes a las 07:00 UTC. El workflow debe residir en el branch por defecto `main` para que GitHub Actions programe los eventos schedule.

## Acceso de lectura y seguridad

- Las tablas globales `lidl_offer_snapshots` y `lidl_offer_observations` tienen RLS activada.
- `anon` y `authenticated` solo pueden leer.
- Solo `service_role` puede publicar mediante `publish_lidl_offer_snapshot`.
- No se conceden permisos de escritura al navegador.
- La información de ofertas es común a toda la PWA y no contiene datos personales ni de hogares.

## Límites de los datos

- No es un catálogo completo de alimentación Lidl.
- `productIds` son IDs internos Lidl, no EAN.
- Se conserva `priceBox` original y no se transforma en precio final si las condiciones no son inequívocas.
- Una oferta publicada no garantiza existencias en tienda.
- La comparación automática con Mercadona requiere una correspondencia exacta o confirmación manual de variante.

## Tiendas iniciales

- ES0375 · Castellón-Castalia · CP 12004
- ES0380 · Castellón-Avda. Valencia · CP 12005
- ES0385 · Castellón-Avda. del Mar · CP 12003

El CP 12006 no tuvo coincidencia exacta en la consulta de tiendas; se han elegido tres tiendas de Castellón como primera cobertura.
