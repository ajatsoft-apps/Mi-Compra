# Fase 9 — Lidl: ofertas semanales (prototipo aislado)

## Objetivo

Validar si podemos obtener ofertas semanales de Lidl España mediante los endpoints JSON usados por la integración comunitaria [FaserF/ha-lidl](https://github.com/FaserF/ha-lidl), antes de diseñar tablas, importadores o cambios en el comparador.

Esta fase no modifica Supabase, la PWA, el optimizador ni el importador OpenCesta.

## Hallazgo técnico

El cliente de `FaserF/ha-lidl` utiliza:

- Catálogo de tiendas por país: `https://stores.lidlplus.com/api/v4/{COUNTRY}`
- Ofertas por tienda: `https://offers.lidlplus.com/app/api/v4/{COUNTRY}/{STORE_KEY}/offers`

Para España usa `ES`. La integración solicita primero el catálogo de tiendas y selecciona una tienda; después consulta las ofertas de esa tienda.

Los campos de oferta que modela el proyecto incluyen:

- `id`, `title`, `brand`, `category`, `offerType`
- `startValidityDate`, `endValidityDate`
- `priceBox` (precio y partes del precio anterior/descuento)
- `packaging`, `pricePerUnit`, `imageUrl`

El modelo de oferta consultado no define un EAN. No se debe asumir que las ofertas incluyen código de barras.

## Alcance de esta prueba

El script `scripts/probe_lidl_weekly_offers.py`:

1. Hace una petición GET al catálogo español de tiendas.
2. Busca primero el código postal configurado (por defecto 12006) y, si no hay coincidencia, busca tiendas cuya localidad contenga Castelló/Castellón.
3. Consulta las ofertas de una sola tienda.
4. Guarda el resultado como artefacto de GitHub Actions durante 7 días.
5. Informa de los campos realmente presentes y de si aparece algún identificador EAN explícito.

La prueba es de solo lectura y no requiere credenciales, cookies, tokens ni acceso a Supabase. Usa un cliente HTTP normal; si Lidl responde 401/403/429, se registra el resultado y no se intentan técnicas de evasión, fingerprinting ni rotación de proxies.

## Ejecución

En GitHub:

1. Abrir Actions.
2. Seleccionar **Probe Lidl weekly offers (read-only)**.
3. Pulsar **Run workflow**.
4. Mantener el código postal 12006, salvo que se quiera probar otra zona.
5. Descargar el artefacto `lidl-weekly-offers-probe` al terminar.

## Criterios de aceptación

No se integrará ningún dato en producción hasta verificar:

- Respuesta HTTP satisfactoria sin autenticación.
- Tienda seleccionada y ámbito geográfico identificable.
- Número y variedad de ofertas recibidas.
- Precio y fechas de validez interpretables.
- Disponibilidad real de precio por unidad.
- Presencia o ausencia de EAN, sin inferirlo por el identificador interno.
- Estabilidad de las respuestas y frecuencia razonable de consulta.

## Límites importantes

- Esto es un endpoint interno utilizado por una integración comunitaria, no una API pública documentada ni una garantía de servicio de Lidl.
- El resultado es un conjunto de ofertas asociado a una tienda, no el catálogo completo de alimentación ni el surtido ordinario.
- El precio de folleto/oferta no garantiza stock ni disponibilidad en el establecimiento.
- La licencia MIT de la integración comunitaria cubre su código, no concede por sí misma derechos sobre los datos de Lidl. Antes de redistribuir o publicar datos habrá que revisar las condiciones aplicables.
- La API de tickets Lidl Plus es una fuente separada de precios realmente pagados; no debe mezclarse con los precios de oferta vigentes.

## Arquitectura prevista si la prueba funciona

1. Adaptador Lidl independiente que transforme la respuesta original a un esquema interno normalizado.
2. Almacenamiento separado por cadena, fuente, tienda, fecha de captura y vigencia.
3. Conservación de la procedencia y del tipo de precio (oferta, precio anterior, precio por unidad, precio de ticket).
4. EAN solo cuando venga de una fuente que lo proporcione explícitamente y pase validación.
5. Integración en el comparador únicamente cuando exista coincidencia inequívoca de producto y unidad.

No se cambia todavía el esquema actual de Mercadona/OpenCesta ni se despliega nada en producción.
