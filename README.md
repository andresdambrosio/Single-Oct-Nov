# 🎾 Single Oct-Nov

Resultados, tabla y ranking de un torneo amateur de singles.
🌐 **Sitio:** https://andresdambrosio.github.io/Single-Oct-Nov/

## Qué tiene

- **Inicio**: últimos resultados, tabla resumida, ranking Elo y próximos partidos.
- **Tabla**: posiciones por zona según el reglamento (2 pts al ganador, 1 al perdedor que gana un set),
  con la probabilidad de clasificar a cuartos.
- **Partidos**: resultados arriba y lo que falta por semana, con la probabilidad de cada jugador.
- **Ranking**: rating Elo de todos los jugadores, más un comparador cara a cara.
- **Jugadores**: foto, descripción y partidos de cada jugador (`#jugador/<id>`).
- **Pronóstico**: probabilidad de clasificar y de salir campeón, simulando el resto del torneo.
- **Cómo funciona** (`#como-funciona`): explica la tabla, el Elo y las probabilidades.

## Modelo de probabilidades

- Todos arrancan con **1500 de rating**, o sea 50% de chances contra cualquiera.
- Después de cada partido se aplica Elo (K = 48): el ganador le saca puntos al perdedor, y saca más
  cuanto menos esperado era el resultado. Ganar 2-0 pesa ×1.25 y ganar 2-1, ×0.85.
- P(A gana) = 1 / (1 + 10^((R_B − R_A)/400)).
- Para el resultado exacto se busca la probabilidad de ganar un set `s` tal que s²(3 − 2s) = P(A gana).
- Clasificar y campeón: 20.000 simulaciones Monte Carlo con semilla fija, usando el cuadro de la hoja "Reglas"
  (1A–4B, 2B–3A, 1B–4A, 2A–3B).

Todo está en [`src/model.js`](src/model.js).

## Datos

La fuente es la [planilla del torneo](https://docs.google.com/spreadsheets/d/1hQ_jrAQ1afHX7QEzM3namN13iiXOY62NSU-iyUpsphU).
`npm run sync` baja las hojas *Posiciones* y *Partidos* como CSV y genera `data/tournament.json`.
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

- Cargar el playoff cuando termine la fase de grupos.
- Fotos y descripciones de los jugadores en `data/profiles.json`.
