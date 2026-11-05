# Catálogo Lidl España

## Fuentes combinadas

El autocompletado Lidl combina tres fuentes públicas distintas:

1. **Buscador de la tienda online** (/q/api/search, versión 2.0): devuelve el catálogo online, precio, marca, imagen, categoría y disponibilidad. La exploración completa recuperó 6.489 productos únicos. Este catálogo contiene mucho bazar y no equivale al surtido completo de alimentación de una tienda física; sus precios se etiquetan como online.
2. **Páginas públicas de Lidl España**: ofertas semanales, próxima semana, fin de semana, fruta/verdura, pescado, carne, panadería, «Tus otras marcas de siempre» (actual y próxima semana) y «Deluxe». Sus atributos data-grid-data incluyen nombre, códigos internos, marca, categoría, imagen, formato, precios regionales, precios Lidl Plus y vigencias. El importador sigue los enlaces de paginación.
3. **Búsqueda dirigida de alimentación**: además del catálogo sin consulta, se buscan términos habituales (leche, huevos, queso, yogur, carne, pollo, pescado, pan, arroz, pasta, aceite, fruta, verdura, café, etc.) y solo se aceptan resultados cuya categoría sea de alimentación. Esto permite recuperar promociones alimentarias que no aparecen en el listado completo.\n4. **Lidl Plus por tienda**: conserva las ofertas específicas de las tiendas configuradas. El código nat de las páginas públicas se relaciona con product_ids de Lidl Plus, de modo que se puede enriquecer una oferta sin aproximar por nombre.

## Importación

scripts/import_lidl_catalog.py descarga el catálogo online con dos pasadas (price y price-desc), usa el tamaño real devuelto por cada página para avanzar el offset y elimina duplicados por ID. Después lee las páginas públicas de tienda y añade los precios actuales y futuros.

La importación crea un snapshot en estado staging, inserta los registros por lotes y solo lo publica mediante publish_lidl_catalog_snapshot cuando el número de filas coincide y se supera el mínimo de 6.000 productos. Si una descarga queda incompleta, el snapshot publicado anterior sigue siendo el que utiliza la PWA.

El precio de tienda se prioriza sobre el precio online. Si existe precio Lidl Plus se muestra como tal; los precios futuros no se ofrecen hasta que comienza su vigencia. Los productos alimentarios sin precio publicado también pueden aparecer, claramente etiquetados como «Precio no publicado»; no se inventan importes. Los productos a granel se guardan con unidad kg; los envasados con ud.

## Región y programación

La región predeterminada es Castellón (LIDL_REGION_NAME). En la prueba de las páginas de Lidl España, Castellón resolvió el grupo de precios 1. Se puede cambiar con la variable de entorno si cambia la zona de tiendas.

El workflow .github/workflows/import-lidl-catalog.yml está preparado para ejecutarse manualmente o lunes y viernes a las 07:30 UTC, después de la importación de ofertas Lidl Plus de las 07:00 UTC. El archivo de workflow debe estar en la rama por defecto de GitHub para que funcione el evento programado; el workflow descarga el código de fase-5/backend-supabase.

## Límites conocidos

Lidl no ofrece un API público documentado con el surtido completo de cada tienda física. El buscador online no contiene todos los productos de alimentación habituales y el feed de ofertas no sustituye al catálogo de estantería. No se han encontrado EAN/GTIN en el conjunto online probado. La PWA no inventa productos ni precios: si un artículo no aparece en estas fuentes, se puede añadir como producto genérico y completar el precio manualmente.
