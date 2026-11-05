# Fase 9 — Lidl: ofertas semanales (prototipo aislado)

## Objetivo

Validar si podemos obtener ofertas semanales de Lidl España mediante los endpoints JSON usados por la integración comunitaria [FaserF/ha-lidl](https://github.com/FaserF/ha-lidl), antes de diseñar tablas, importadores o cambios en el comparador.

Esta fase no modifica Supabase, la PWA, el optimizador ni el importador OpenCesta.

## Hallazgo técnico

El cliente de `FaserF/ha-lidl` utiliza:

- Catálogo de tiendas por país: `https://stores.lidlplus.com/api/v4/{COUNTRY}`
- Ofertas por tienda: `https://offers.lidlplus.com/app/api/v4/{COUNTRY}/{STORE_KEY}/offers`

Para España usa `ES`. La integración solicita primero el catálogo de tiendas y después consulta las ofertas de cada tienda.

Los campos de oferta observados incluyen:

- `id`, `title`, `brand`, `category`, `offerType`, `redemptionChannel`
- `productIds` (identificadores internos cortos, no EAN)
- `startValidityDate`, `endValidityDate`
- `priceBox` (precio, precio anterior y texto de descuento)
- `imageUrl`

Aunque el modelo comunitario contempla `packaging` y `pricePerUnit`, en la prueba española esos campos llegaron vacíos.

## Prueba real ejecutada

Workflow: [GitHub Actions run 42028921245](https://github.com/ajatsoft-apps/Mi-Compra/actions/runs/42028921245)

Resultado:

- HTTP satisfactorio en ambos endpoints usando Python `urllib`, sin autenticación, cookies, tokens, fingerprinting ni proxies.
- El catálogo español devolvió 698 tiendas.
- No apareció una tienda con CP exacto 12006. La búsqueda de respaldo encontró las tres tiendas de Castellón de la Plana: Castellón-Castalia (12004), Avda. Valencia (12005) y Avda. del Mar (12003).
- Se consultaron las tres tiendas: 31 ofertas por tienda, 93 registros en total.
- Las 31 ofertas tenían los mismos identificadores en las tres tiendas consultadas. Esto sugiere que esas promociones son comunes a las tres, pero no permite generalizar a toda España.
- Por tienda: 28 ofertas con canal `Store` y 3 con canal `OnlineShop`.
- 26 de las 31 ofertas incluían un valor numérico de precio; 5 solo contenían mensajes de descuento sin precio numérico utilizable.
- 21 ofertas indicaban símbolo `€`, 5 indicaban `€/kg` y 5 no tenían símbolo/precio directo.
- 28 de 31 tenían marca informada.
- No apareció ningún EAN explícito.
- `productIds` contiene valores como `0080088` y `0083215`: son códigos internos de 7 dígitos y no deben tratarse como EAN.
- `packaging` y `pricePerUnit` llegaron vacíos en las ofertas consultadas.
- Los nombres y algunas descripciones aparecen en inglés aunque la petición usa `Accept-Language: es-ES`.

## Conclusión técnica

**La fuente es viable para importar ofertas semanales de Lidl España**, al menos en la muestra de Castellón, sin depender de Apify ni de credenciales Lidl Plus.

No es suficiente para un comparador completo de productos:

- No ofrece EAN en las ofertas observadas.
- No ofrece el catálogo ordinario completo.
- No ofrece un precio por unidad normalizado en la muestra.
- Algunas promociones son porcentuales o por varias unidades y no contienen un precio final numérico.
- Hay ofertas de tienda y ofertas exclusivas de tienda online que deben mantenerse separadas.
- El CP 12006 no tiene tienda devuelta con coincidencia exacta; se han consultado tres establecimientos de la misma ciudad, no se debe fingir que uno corresponde exactamente a ese CP.

## Límites importantes

- Es un endpoint interno utilizado por una integración comunitaria, no una API pública documentada ni una garantía de servicio de Lidl.
- El resultado es un conjunto de ofertas, no el catálogo completo de alimentación ni el surtido ordinario.
- El precio anunciado no garantiza stock ni disponibilidad real en el establecimiento.
- La licencia MIT de la integración comunitaria cubre su código, no concede por sí misma derechos sobre los datos de Lidl. Antes de redistribuir o publicar datos habrá que revisar las condiciones aplicables.
- La API de tickets Lidl Plus es una fuente separada de precios realmente pagados; no debe mezclarse con los precios de oferta vigentes.

## Arquitectura prevista

1. Adaptador Lidl independiente que transforme la respuesta original a un esquema interno normalizado.
2. Almacenamiento separado por cadena, fuente, tienda, fecha de captura y vigencia.
3. Conservación de la procedencia y del tipo de precio (oferta, precio anterior, descuento porcentual, precio por unidad, precio de ticket).
4. EAN solo cuando venga de una fuente que lo proporcione explícitamente y pase validación.
5. Las ofertas sin precio numérico final no deben participar en cálculos de cesta.
6. Integración en el comparador únicamente cuando exista coincidencia inequívoca de producto y unidad.

No se cambia todavía el esquema actual de Mercadona/OpenCesta ni se despliega nada en producción.


## Revisión de condiciones de uso

El aviso legal de Lidl España atribuye a Lidl o a sus licenciantes los derechos sobre los contenidos del portal y prohíbe la reproducción, distribución y comunicación pública de contenidos con fines comerciales sin autorización. Las condiciones de Lidl Plus también describen la participación como de uso privado y excluyen la participación comercial.

Por tanto:

- La prueba técnica no equivale a permiso para redistribuir datos.
- No publicar una API abierta ni exponer imágenes/contenidos de Lidl a terceros.
- Antes de un despliegue público o comercial, solicitar autorización o confirmar formalmente el marco de uso aplicable.
- Cualquier siguiente fase debe mantener acceso autenticado y familiar, limitar la frecuencia de consulta y conservar la atribución/procedencia, sin asumir que eso resuelve por sí solo las cuestiones de derechos.

Referencias consultadas: [Aviso legal de Lidl España](https://www.lidl.es/c/aviso-legal/s10075786) y [condiciones de uso de Lidl Plus](https://www.lidl.es/c/lidl-plus-informacion-condiciones-de-uso/s10086146).
