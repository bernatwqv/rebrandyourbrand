# Registro Técnico y Arquitectura de Resiliencia en Edge

- **Fecha:** 2026-11-01
- **Commit de referencia:** `91af93e` (fix: resiliencia y latencia en Resend y Groq con ejecucion asincrona y presupuestos estrictos)
- **Autor y equipo:** Bernat Domènech y Gael Domènech (rebrandyourbrand.es)
- **Ámbito:** Cloudflare Workers, Cloudflare KV, Groq Cloud API, Resend Transactional Email API

---

## Resumen Ejecutivo

Durante la auditoría técnica integral del backend serverless en Cloudflare Workers (`src/`), se detectaron y subsanaron puntos críticos de latencia, cuellos de botella por fan-out de llamadas a APIs externas y vulnerabilidades de resiliencia en los flujos de mensajería (Resend) e inteligencia artificial (Groq). 

La optimización transformó un modelo sincrónico con riesgo de bloqueo en cascada en una arquitectura defensiva, tolerante a fallos y con latencias de respuesta al cliente inferiores a 100 ms. Este documento consolida las lecciones aprendidas, patrones de diseño y directrices obligatorias para el mantenimiento de `rebrandyourbrand.es` y para el desarrollo de nuevos proyectos dentro del ecosistema del estudio (tales como Botanic Atelier Floral).

---

## 1. Ciclo de Vida en el Edge y Desacoplamiento Asíncrono (`ctx.waitUntil`)

### 1.1. Regla de Oro: Persistencia Previa a Notificaciones
En un entorno distribuido en el Edge, **la persistencia del estado del negocio en la base de datos (KV) siempre debe preceder a cualquier notificación externa**. 

- Una caída de red, lentitud o error en un proveedor de terceros (Resend, Stripe, Groq) jamás debe abortar una transacción de usuario ni provocar un error HTTP 500.
- Si un cliente aprueba una fase, solicita revisiones, envía materiales o registra un mensaje, el cambio de estado se valida y se consolida primero mediante `saveProject()`.
- Una vez asegurado el registro en KV, el disparo de correos o eventos derivados se ejecuta como una tarea secundaria protegida con bloques `try...catch` independientes.

### 1.2. Despacho Fuera del Hilo Crítico con `ctx.waitUntil`
Aguardar de forma sincrónica llamadas de red a terceros dentro del hilo de respuesta de la petición HTTP degrada severamente el Time to First Byte (TTFB) y la experiencia de usuario (INP):

- **Antes:** Un POST en el chat o en la entrega de materiales aguardaba la llamada a Resend y a la IA, demorando la respuesta al cliente entre 2.500 ms y 4.000 ms. Un fallo de conexión devolvía un error en la interfaz.
- **Después:** Los manejadores (`handleProject`, `handleStudioChat`, `handlePhaseApprove`, `deliverVerifiedLead`, `handleStripeWebhook`) reciben el contexto de ejecución (`ctx`) y delegan el envío de correos a `ctx.waitUntil(emailTask())`.
- **Impacto:** La latencia percibida por el usuario descendió a menos de 80 ms, mientras que el Worker mantiene vivo el contexto de fondo en Cloudflare hasta que las peticiones a Resend concluyen exitosamente.

### 1.3. Resiliencia en Resend: Reintentos con Retroceso y Cabeceras Estándar
La función central `resendSend` (`src/email.js`) implementa un protocolo defensivo contra saturación y microcortes:

- **Bucle de 2 intentos con retroceso (backoff):** Ante respuestas HTTP 429 (rate limit) o errores 5xx del servidor de correo, el sistema aguarda 1.200 ms antes de realizar un segundo intento.
- **Extracción del cuerpo de error (`errText`):** Se parsea y registra en logs el mensaje de error exacto de la API para facilitar la observabilidad sin ocultar excepciones silenciosas.
- **Cabeceras ergonómicas:** Se incorporan cabeceras estándar de correo (`Reply-To`, `In-Reply-To`, `References`, `Auto-Submitted: auto-generated`, `X-Entity-Ref-ID`) garantizando una correcta agrupación por hilos en los clientes de correo del estudio y evitando respuestas en bucle de sistemas automáticos.

---

## 2. Integridad de KV, Metadatos y Paginación en Cron

### 2.1. Centralización Obligatoria en `saveProject`
Para evitar discrepancias en metadatos, serialización o prefijos:

- Queda estrictamente prohibido realizar llamadas en crudo `.put()` sobre `LEADS_KV` con el prefijo `project:` fuera del helper central `saveProject()`.
- Toda mutación de un proyecto debe pasar por `saveProject(env, project, reqOrIp)`, el cual estandariza la actualización de marcas temporales (`updated_at`), sincronización de índices y asignación de TTL.

### 2.2. Gestión Estricta de `expirationTtl`
El almacenamiento en Cloudflare KV debe autolimpiarse para proyectos no consolidados y preservar perpetuamente los proyectos facturados:

- **Proyectos no pagados (`proj.paid === false`):** Se les aplica un TTL de expiración estricto de 7 días (604.800 segundos). Esto evita la acumulación de proyectos abandonados o pruebas huérfanas en el almacenamiento.
- **Proyectos pagados (`proj.paid === true`):** Tras la confirmación de pago por Stripe (`checkout.session.completed`), la clave se persiste de forma indefinida (`expirationTtl` no se define en `.put()`), protegiendo el historial y entregables del cliente para siempre.

### 2.3. Paginación del Cron mediante Cursor Persistente y Límite de Subrequests
El plan gratuito de Cloudflare Workers impone un límite de 50 subrequests por invocación. Para tareas periódicas de mantenimiento (`src/cron.js`):

- **Cursor persistente:** La lectura de proyectos se realiza mediante paginación basada en cursor (`cursorKey = "cron:project_cursor"`). Cada ejecución reanuda la revisión exactamente donde quedó la anterior.
- **Presupuesto de lecturas (`maxGets = 35`):** Se fija un techo estricto de 35 lecturas por ejecución de Cron, garantizando un margen de seguridad amplio por debajo del límite de la plataforma y eliminando el riesgo de lecturas infinitas o saturación de CPU.

---

## 3. Resiliencia y Consumo de APIs de IA (Groq)

### 3.1. Presupuestos Estrictos de Latencia y Tamaño
Las llamadas a modelos de lenguaje (`src/ai.js`) deben estar estrictamente acotadas para evitar congelaciones del Worker:

- **`AbortSignal.timeout` obligatorio:** Cada petición a la API de Groq cuenta con un temporizador estricto (8.000 ms para chat general en `askGroq` y 4.500 ms para traducciones en `translateMessageText`). Si Groq supera ese umbral, la conexión se aborta inmediatamente.
- **Límites de tokens de salida ajustados:** Máximo de 600 tokens en Brandi y 450 tokens en traducciones y resúmenes de proyectos (`askGroqProject`), evitando respuestas verbosas innecesarias y reduciendo costes de procesamiento.
- **Temperatura calibrada:** Uso de `temperature: 0.1` en tareas deterministas de traducción y formateo, garantizando precisión terminológica y eliminando alucinaciones.

### 3.2. Erradicación del Fan-Out en Peticiones GET
Las peticiones de lectura (`GET /proyecto` y `GET /responder-chat`) nunca deben realizar llamadas masivas y descontroladas a servicios de terceros:

- **Ventana de traducción acotada:** Se limita el procesamiento automático a los últimos mensajes relevantes (`.slice(-2)`), evitando traducir históricos completos de una conversación en un solo renderizado.
- **Cacheo permanente en KV:** Las traducciones se almacenan en el objeto `translations[targetLang]` del mensaje en KV. Crucialmente, si Groq falla o supera los límites de cuota (30 RPM), se guarda el texto original como fallback en la caché para evitar que recargas consecutivas de la página vuelvan a disparar peticiones fallidas a la API.

### 3.3. Rigor de Parámetros y Voz de Marca
- **Cero parámetros incompatibles:** No enviar banderas experimentales o no admitidas por modelos generales (como `reasoning_effort: "low"` en `llama-3.3-70b-versatile`), lo cual provocaba errores 400 en la API de Groq.
- **Fallback editorial en minúsculas:** Los mensajes de degradación elegante ante indisponibilidad del servicio de IA se redactan en minúscula completa, alineándose con las directrices de voz de marca de rebrandyourbrand.es (clase `lowercase`).

---

## 4. Protocolo Defensivo de Compilación y Verificación (`verify_all.mjs`)

### 4.1. El Script de Verificación como Linter Estricto de Ingeniería
El pipeline de integración y despliegue del proyecto utiliza `verify_all.mjs` como guardián de calidad antes de cualquier paso a producción:

- **Rastreo de variables de ámbito:** Verifica la propagación coherente de parámetros críticos como `ip`, `reqOrIp` y `ctx` a través de toda la cadena de middleware y manejadores.
- **Validación de firmas de funciones:** Comprueba que helpers compartidos (como `saveProject`) mantengan su firma esperada en todos los módulos (`src/handlers.js`, `src/payments.js`, `src/cron.js`).
- **Veto total a caracteres prohibidos:** Ningún archivo del repositorio puede contener puntos medios (middle dots), viñetas de lista (bullet dots) o signos ampersand literales.
- **Paridad estricta en 4 idiomas:** Todo texto nuevo o modificado debe existir obligatoriamente en español (`es`), catalán (`ca`), inglés (`en`) y euskera (`eu`).

### 4.2. Flujo de Trabajo Obligatorio para Futuros Proyectos
Para cualquier cambio futuro en `rebrandyourbrand.es` o en nuevos proyectos del estudio (como Botanic Atelier Floral), el equipo seguirá rigurosamente el siguiente ciclo:

1. **Edición modular en `src/`:** Modificaciones mínimas y quirúrgicas en los módulos correspondientes.
2. **Chequeo de sintaxis:** `node --check src/<modulo>.js`.
3. **Compilación de bundle:** `node build.mjs` para regenerar `worker.js`.
4. **Verificación exhaustiva:** `node --check worker.js` y `node verify_all.mjs`.
5. **Comprobación visual y funcional:** Pruebas en navegador integrado a 390 px y 1440 px en tema claro y oscuro.
6. **Consolidación en Git:** Commit atómico y push a la rama principal.

---

*Fin del registro técnico. Documento de obligado cumplimiento arquitectónico.*
