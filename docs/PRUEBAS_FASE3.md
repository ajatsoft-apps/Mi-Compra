# Pruebas manuales — Gestión familiar

La gestión familiar está implementada en la rama `fase-3/gestion-familiar`. Antes de integrar los cambios en la rama de publicación, completar las pruebas con cuentas distintas y navegadores/dispositivos separados.

## Preparación

- Cuenta A: propietario inicial del hogar.
- Cuenta B: miembro invitado.
- Cuenta C: cuenta que no pertenece al hogar.
- Usar navegadores o perfiles separados para evitar compartir la sesión.
- Añadir un producto de prueba sin datos personales.

## Invitaciones

- [ ] A crea un código; se muestra una sola vez y se copia al portapapeles si el navegador lo permite.
- [ ] B, autenticado, acepta el código y entra en el mismo hogar.
- [ ] A y B ven los cambios de la misma lista.
- [ ] C no puede consultar miembros, invitaciones ni productos del hogar.
- [ ] A revoca un código; C no puede utilizarlo después.
- [ ] Un código caducado o agotado no permite incorporaciones.
- [ ] Un miembro puede revocar sus propios códigos, pero no los creados por otro miembro (salvo que sea propietario).

## Miembros y permisos

- [ ] A y B aparecen con correo, rol y fecha de incorporación.
- [ ] B no ve controles para retirar miembros ni transferir la propiedad.
- [ ] B no puede ejecutar esas operaciones llamando directamente a las RPC.
- [ ] A retira a B; B deja de poder leer o modificar datos remotos del hogar.
- [ ] Las invitaciones activas creadas por B se revocan al retirarlo.
- [ ] A transfiere la propiedad a B; B pasa a propietario y A queda como miembro.
- [ ] El antiguo propietario ya no puede retirar miembros ni transferir la propiedad.
- [ ] Si el propietario abandona el hogar sin transferirlo manualmente, el miembro más antiguo pasa a ser propietario.
- [ ] Un miembro puede abandonar el hogar sin afectar al resto.

## Datos locales y dispositivos

- [ ] Tras retirar a B, la copia que B ya tenía descargada puede seguir visible localmente; debe quedar desconectada del hogar y no sincronizar cambios remotos.
- [ ] La retirada no borra ni altera la lista de los demás miembros.
- [ ] Cerrar sesión y volver a entrar conserva el hogar correcto.
- [ ] Probar en iPhone Safari instalado, Android Chrome y navegador de escritorio.

## Criterio de aceptación

La fase se considera validada cuando las pruebas de permisos y revocación se completan con cuentas reales. La compilación correcta por sí sola no demuestra el aislamiento entre usuarios.
