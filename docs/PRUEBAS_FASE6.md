# Pruebas de aceptación — Fase 6

Realizar con dos cuentas (A y B) que pertenezcan al mismo hogar y una tercera cuenta C de otro hogar.

## Catálogo y lista

1. En A, crear un producto con nombre, marca, formato y código EAN.
2. Comprobar que B lo ve sin recargar la página (Realtime).
3. Añadirlo a la lista desde el catálogo y comprobar que aparece con marca y formato.
4. En B, editar el producto y comprobar que A recibe el cambio.
5. Archivar el producto y verificar que deja de ofrecerse al añadirlo, pero que la referencia de la lista y el historial no se pierden.
6. Intentar crear el mismo EAN dos veces en el mismo hogar; la base de datos debe rechazar el duplicado.
7. Intentar asociar desde la API un producto de otro hogar; la clave foránea compuesta debe impedirlo.

## Preferencias y equivalencias

1. Guardar marca y formato preferidos y desactivar sustitutos.
2. Comprobar que B ve las preferencias.
3. Añadir una equivalencia de tipo «sustituto aceptado».
4. Comprobar que no se crean equivalencias automáticas por nombres parecidos.
5. Retirar una equivalencia y comprobar que desaparece en ambos dispositivos.

## Historial de compras

1. Registrar una compra con cantidad, precio por envase y establecimiento.
2. Si se indica precio unitario sin total, comprobar el cálculo del total.
3. Comprobar que A y B ven la misma compra.
4. Archivar el producto y comprobar que la compra histórica permanece.
5. Verificar que la interfaz presenta el importe como precio pagado, no como precio actual.

## Aislamiento y modo sin conexión

1. Comprobar que C no puede leer ni modificar productos, preferencias, equivalencias ni compras del hogar A/B.
2. Abrir el catálogo con conexión, después desconectar internet y comprobar que la caché de productos permite consultar y añadir a la lista local.
3. Sin conexión, comprobar que las mutaciones del catálogo y el registro de compras quedan deshabilitados o muestran el aviso correspondiente.
4. Recuperar conexión y comprobar que la lista añadida desde el catálogo se sincroniza con su referencia catalog_product_id.
5. Probar Safari iOS, Chrome Android y escritorio.

## Criterio de cierre

La fase solo se considerará validada cuando CI esté verde y pasen las pruebas multiusuario, de aislamiento y de uso en los tres entornos. La compilación por sí sola no demuestra el comportamiento de RLS ni Realtime.
