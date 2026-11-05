# Fase 9 — Investigación técnica de Lidl

## Alcance de esta entrega

Esta rama incorpora una sonda temporal y de solo lectura para evaluar la búsqueda pública de la tienda web de Lidl España (https://www.lidl.es/q/api/search). No descarga catálogos completos, no inicia sesión, no usa credenciales Lidl, no escribe en Supabase y no altera el importador de OpenCesta.

La sonda realiza cuatro búsquedas acotadas en español (leche, aceite de oliva, arroz y detergente), con una pausa entre peticiones. Guarda una muestra de hasta 12 resultados por búsqueda como artefacto temporal de GitHub Actions.

## Qué se valida

- Si el endpoint responde desde GitHub Actions.
- Si la respuesta contiene resultados de producto interpretables.
- Disponibilidad de nombre, marca, precio de venta, precio de referencia, unidad, envase y categoría.
- Presencia de un campo EAN/GTIN/barcode explícito. El identificador interno del producto nunca se interpreta como EAN.
- Forma y estabilidad básica del JSON recibido.

## Límites conocidos

- El endpoint es una interfaz web observada y utilizada por proyectos comunitarios; no es una API oficial documentada para desarrolladores.
- Los resultados de búsqueda no demuestran que exista un catálogo alimentario completo ni que incluyan todos los productos permanentes.
- El precio de la tienda online no demuestra disponibilidad ni precio de una tienda física concreta de Castellón.
- El código de los scrapers comunitarios puede orientar la implementación, pero su licencia no concede derechos sobre los datos, textos o imágenes de Lidl.
- No se publicarán datos en la aplicación ni se compararán cestas hasta revisar la muestra, la cobertura, la estabilidad y las condiciones de reutilización aplicables.

## Cómo se ejecuta

The workflow CI ejecuta la sonda únicamente en un pull request cuyo título contenga [LIDL PROBE]. El resultado se conserva como artefacto durante siete días. Si Lidl bloquea la petición, cambia el esquema o devuelve datos que no se pueden interpretar, la prueba queda fallida y no se importa nada.

## Criterio para avanzar

Solo se planteará una integración de precios si la muestra confirma campos consistentes y suficientes. Para el optimizador, la coincidencia entre cadenas seguirá requiriendo EAN exacto; no se usarán nombres parecidos como sustituto de un código de barras.
