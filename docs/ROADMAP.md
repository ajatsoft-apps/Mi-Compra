# Hoja de ruta

## Fase 1 — Análisis funcional

Cerrada. Definidos el uso familiar, la lista compartida, preferencias, aprendizaje prudente y objetivos de optimización.

## Fase 2 — Viabilidad y arquitectura

Cerrada. React + TypeScript, Vite, PWA, Supabase, PostgreSQL, RLS, Realtime e IndexedDB como arquitectura prevista. Las fuentes de precios se incorporarán de forma gradual y verificable.

## Fase 3 — Proyecto y estructura inicial

Cerrada. Estructura React/TypeScript/Vite y PWA creadas. La compilación de producción y la comprobación de tipos han superado GitHub Actions.

## Fase 4 — Primera base funcional

Cerrada a nivel de código y compilación.

- [x] Pantalla inicial de la lista de compra.
- [x] Añadir productos con cantidad, unidad, categoría y nota.
- [x] Marcar productos como comprados y retirarlos de la lista.
- [x] Filtros de pendientes, todos y comprados.
- [x] Guardado local con IndexedDB y migración/respaldo desde `localStorage`.
- [x] Modelo local de hogares, miembros, listas y productos.
- [x] Migración SQL inicial de Supabase con políticas RLS y controles de pertenencia.
- [x] PWA con icono de instalación para iOS.
- [x] Compilación de producción y auditoría de dependencias de producción superadas en GitHub Actions.
- [ ] Pruebas manuales de uso en móviles y tablets (se completarán en la fase de pruebas).

**Límite actual:** la lista todavía se guarda en el dispositivo. La sincronización entre familiares no está activada hasta configurar Supabase y autenticación.

## Fase 5 — Backend y sincronización

Cerrada a nivel de implementación y despliegue de pruebas. Supabase Auth, PostgreSQL, RLS, Realtime, tombstones y sincronización offline-first están conectados. Las pruebas bidireccionales iniciales entre dispositivos han sido satisfactorias; queda mantener pruebas de uso prolongado y escenarios límite.

- [x] Registro e inicio de sesión por correo.
- [x] Creación y recuperación del hogar y la lista compartida.
- [x] Sincronización inicial, cambios, borrados lógicos y Realtime.
- [x] Reintentos tras recuperar conexión y actualización tras recargar la PWA.
- [x] Códigos de invitación con hash, caducidad y límite de usos.
- [x] Consulta de miembros y roles dentro del hogar.
- [x] Revocación de invitaciones propias y por el propietario.
- [x] Retirada de miembros por el propietario y revocación de sus invitaciones activas.
- [x] Transferencia explícita de propiedad y transferencia automática al abandonar el propietario.
- [x] Validación de permisos en funciones privadas y wrappers públicos SECURITY INVOKER.
- [ ] Pruebas manuales con dos o más cuentas para invitación, retirada, transferencia y salida del propietario.
- [ ] Pruebas de conflicto simultáneo y reloj desajustado durante uso prolongado.

**Limitaciones conocidas:** un dispositivo tiene un hogar activo y no hay selector de varios hogares; los conflictos de edición simultánea usan last-write-wins. La revocación impide nuevos accesos al servidor, pero no puede borrar datos ya descargados del almacenamiento local de otro dispositivo.

## Fase 6 — Catálogo, preferencias y compras

Implementación integrada y desplegada en `fase-5/backend-supabase`. CI correcto y pruebas funcionales del usuario en varios dispositivos/cuentas satisfactorias.

- [x] Catálogo familiar con nombre, marca, EAN/GTIN, formato, categoría y notas.
- [x] Añadir productos del catálogo a la lista conservando la referencia al producto.
- [x] Preferencias familiares de marca, formato y aceptación de sustitutos.
- [x] Equivalencias y sustitutos explícitos, sin asignación automática por similitud.
- [x] Registro de compras con cantidad, precio unitario, total y establecimiento.
- [x] Historial de compras compartido por hogar.
- [x] RLS, índices, restricciones de integridad y Realtime para las nuevas tablas.
- [x] Caché local del catálogo para consulta y uso al añadir a la lista sin conexión.
- [x] Pruebas multiusuario de catálogo y sincronización en varios dispositivos realizadas por el usuario.
- [x] Pruebas funcionales de uso del catálogo en dispositivos reales realizadas por el usuario.
- [ ] Pruebas prolongadas de conflictos y permisos de gestión familiar.

**Límite actual:** la consulta del catálogo puede utilizar su última caché local, pero editar productos, preferencias, equivalencias y registrar compras requiere conexión. El historial de precios aún no existe: el registro de compras no se debe interpretar como un precio actual ni como una oferta.

## Fase 7 — Fuentes de precios y promociones

En análisis de fuentes. Se han evaluado las fuentes abiertas y los límites de Mercadona. Sus endpoints internos no documentados no se automatizarán hasta confirmar autorización o una fuente reutilizable. La arquitectura admitirá observaciones aportadas por usuarios y proveedores externos con licencias compatibles, manteniendo separados los conjuntos con obligaciones distintas. No se importarán precios de otra zona ni se mostrarán observaciones caducadas como actuales.

- [x] Evaluar fuentes abiertas y condiciones de reutilización.
- [x] Identificar limitaciones de cobertura para Mercadona, Lidl y Carrefour.
- [x] Documentar la decisión de no automatizar endpoints privados de Mercadona sin autorización.
- [ ] Comprobar cobertura real de CholloSúper y Open Prices en el ámbito 12006.
- [ ] Diseñar tablas de observaciones de mercado, fuentes, ámbito geográfico y evidencia.
- [ ] Implementar el primer adaptador con licencia reutilizable confirmada.
- [ ] Permitir registrar observaciones propias sin confundirlas con un catálogo completo.
- [ ] Mostrar fecha, fuente, zona y condiciones de cada precio/oferta.
- [ ] Pruebas de calidad, caducidad, deduplicación y datos ausentes.

## Fase 8 — Comparador y optimizador

Pendiente: reglas deterministas, umbrales de ahorro, promociones condicionadas y costes de desplazamiento.

## Fase 9 — Voz, notificaciones y pruebas

Pendiente: evaluar capacidades reales por plataforma, accesibilidad, offline y pruebas con la familia.
