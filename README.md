# 🎾 Tini Tennis Tour

Sitio de pronósticos del torneo amateur de singles que organiza Matías Tini.
Las apuestas son **con fichas de juego** (cada uno arranca con 1.000), sin plata real.

## Qué tiene

- **Partidos**: fixture por semana con cuotas para ganador y resultado exacto en sets (2-0, 2-1, 1-2, 0-2).
- **Tabla**: posiciones por zona según el reglamento (2 pts al ganador, 1 al perdedor que gana un set),
  con la probabilidad de clasificar a cuartos.
- **Ranking**: rating Elo de todos los jugadores, más un comparador cara a cara.
- **Jugadores**: foto, descripción y partidos de cada jugador (`#jugador/<id>`).
- **Campeón**: cuotas para ganar el torneo, a partir de simular el resto de la fase de grupos y el playoff.
- **Mis apuestas**: boleta, saldo y liquidación automática cuando se carga el resultado.

## Modelo de probabilidades

- Todos arrancan con **1500 de rating**, o sea 50% de chances contra cualquiera.
- Después de cada partido se aplica Elo (K = 48): el ganador le saca puntos al perdedor, y saca más
  cuanto menos esperado era el resultado. Ganar 2-0 pesa ×1.25 y ganar 2-1, ×0.85.
- P(A gana) = 1 / (1 + 10^((R_B − R_A)/400)).
- Para el resultado exacto se busca la probabilidad de ganar un set `s` tal que s²(3 − 2s) = P(A gana).
- Cuota = 1 / (p × 1,06), con un mínimo de 1,05.
- Campeón: 4.000 simulaciones Monte Carlo con semilla fija, usando el cuadro de la hoja "Modalidad"
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

## Próximos pasos

- Hoy las apuestas se guardan en el navegador de cada uno. Para tener un ranking de apostadores
  compartido hace falta un backend chico (Supabase o Firebase) con login.
- Cargar el playoff cuando termine la fase de grupos y liquidar las apuestas a campeón.
