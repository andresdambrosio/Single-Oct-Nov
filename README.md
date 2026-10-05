# 🎾 Single Oct-Nov

Sitio de pronósticos de un torneo amateur de singles.
🌐 **Sitio:** https://andresdambrosio.github.io/Tini-Tennis-Tour/

Las apuestas son **con fichas de juego** (cada uno arranca con 1.000), sin plata real.

## Qué tiene

- **Inicio**: portada con explicación, pasos para jugar y resumen (próximos partidos, resultados, rankings).
- **Partidos**: fixture por semana con cuotas para ganador y resultado exacto en sets (2-0, 2-1, 1-2, 0-2).
- **Tabla**: posiciones por zona según el reglamento (2 pts al ganador, 1 al perdedor que gana un set),
  con la probabilidad de clasificar a cuartos.
- **Ranking**: rating Elo de todos los jugadores, más un comparador cara a cara.
- **Jugadores**: foto, descripción y partidos de cada jugador (`#jugador/<id>`).
- **Campeón**: cuotas para ganar el torneo, a partir de simular el resto de la fase de grupos y el playoff.
- **Mis apuestas**: boleta, saldo y liquidación automática cuando se carga el resultado.
- **Ranking de fichas** (`#fichas`): podio y tabla de quién va ganando, con fichas disponibles, en juego y aciertos.
- **Cómo funciona** (`#como-funciona`): explica fichas, cuotas, resultado exacto, reglas, Elo y cuotas a campeón.

## Modelo de probabilidades

- Todos arrancan con **1500 de rating**, o sea 50% de chances contra cualquiera.
- Después de cada partido se aplica Elo (K = 48): el ganador le saca puntos al perdedor, y saca más
  cuanto menos esperado era el resultado. Ganar 2-0 pesa ×1.25 y ganar 2-1, ×0.85.
- P(A gana) = 1 / (1 + 10^((R_B − R_A)/400)).
- Para el resultado exacto se busca la probabilidad de ganar un set `s` tal que s²(3 − 2s) = P(A gana).
- Cuota = 1 / (p × 1,06), con un mínimo de 1,05.
- Campeón: 20.000 simulaciones Monte Carlo con semilla fija, usando el cuadro de la hoja "Modalidad"
  (1A–4B, 2B–3A, 1B–4A, 2A–3B).

Todo está en [`src/model.js`](src/model.js).

## Datos

La fuente es la [planilla del torneo](https://docs.google.com/spreadsheets/d/1hQ_jrAQ1afHX7QEzM3namN13iiXOY62NSU-iyUpsphU).
`npm run sync` baja las hojas *Posiciones* y *Fixture* como CSV y genera `data/tournament.json`.
La GitHub Action `sync.yml` corre ese mismo comando cada 2 horas y commitea si cambió algún resultado.

Fotos y descripciones de los jugadores: `data/profiles.json`. Las fotos van en `assets/players/<id>.jpg`;
en `photo` se pone esa ruta o una URL.

## Correr local

```bash
npm run sync   # opcional: refresca los datos
npm run dev    # http://localhost:5173
npm test
```

No tiene dependencias. Alcanza con Node 20+ y Python 3, que se usa para servir los archivos estáticos.

## Login con Google y apuestas compartidas (Firebase)

Sin configurar, el sitio anda en **modo local**: cada uno apuesta en su navegador. Con Firebase,
cada uno entra con su Gmail, las apuestas quedan guardadas para todos y aparece la pestaña **Apostadores**.

Reglas del modo compartido:
- Una apuesta por partido y por mercado (ganador / resultado exacto) y una sola a campeón.
- Una vez hecha, una apuesta no se puede cambiar ni borrar.
- Todos los logueados ven las apuestas de todos. Del perfil de cada uno sólo se comparte el nombre y la foto de Google, no el mail.

Para activarlo (gratis, plan Spark):

1. Entrar a https://console.firebase.google.com y crear un proyecto (ej. `tini-tennis-tour`). Analytics no hace falta.
2. **Authentication → Comenzar → Google** → habilitar y guardar.
3. **Authentication → Configuración → Dominios autorizados** → agregar `andresdambrosio.github.io`.
4. **Firestore Database → Crear base de datos**, en modo producción y en la región `southamerica-east1`.
5. **Firestore → Reglas** → pegar el contenido de [`firestore.rules`](firestore.rules) y publicar.
6. **Configuración del proyecto → Tus apps → Web (`</>`)**: registrar la app y copiar el objeto `firebaseConfig`
   en [`src/firebase-config.js`](src/firebase-config.js).
7. Commit y push. GitHub Pages lo publica en 1 o 2 minutos.

Para que entren sólo los participantes, en `firestore.rules` está comentada una lista de mails permitidos.

> El saldo se calcula en el navegador, así que alguien que sepa usar la consola podría apostar más
> de lo que tiene. Para un torneo entre amigos alcanza; si hiciera falta, se blinda con una Cloud Function.

## Próximos pasos

- Cargar el playoff cuando termine la fase de grupos y liquidar las apuestas a campeón.
