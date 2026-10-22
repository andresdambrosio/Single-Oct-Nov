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

**Ranking (Bradley-Terry sobre games, retroactivo).** Cada jugador tiene una fuerza `x`; la chance de ganar un game
contra otro es `σ(x_a − x_b)`. Las fuerzas se estiman con *todos* los partidos a la vez (máximo a posteriori), así que
no importa el orden en que se jugaron y ganarle a alguien que después rinde bien vale más (la idea de PageRank).
- Se usan los **games** de cada set: un 6-0 6-0 pesa más que un 7-6 7-6. El super tie-break cuenta como un game.
- **Prior** gaussiano (desvío 0,3) centrado en el promedio: todos arrancan iguales y quien jugó poco se mueve con prudencia.
- Los games de un mismo partido no son independientes, así que cada uno pesa 0,4.
- El rating se muestra en escala tipo Elo: `1500 + 400·log10(p / (1 − p))`, con `p` = chance de ganarle el partido a un jugador promedio.

**De games a partido.** De la chance de game se despeja la de punto (puntos independientes, sin distinguir saque) y con eso
se calcula exacto: set a 6 con tie-break a 7, super tie-break a 10 y partido al mejor de 3 con super tie-break.

**Clasificar y campeón.** 20.000 simulaciones Monte Carlo con semilla fija del resto de la zona y del cuadro de la hoja "Reglas"
(1A–4B, 2B–3A, 1B–4A, 2A–3B). En cada simulación se sortea el nivel de cada jugador dentro de su incertidumbre
(aproximación de Laplace), así quien jugó un solo partido no queda como favorito seguro.

Todo está en [`src/model.js`](src/model.js).

## Datos

La fuente es la [planilla del torneo](https://docs.google.com/spreadsheets/d/1hQ_jrAQ1afHX7QEzM3namN13iiXOY62NSU-iyUpsphU).
`npm run sync` baja las hojas *Posiciones* y *Partidos* como CSV y genera `data/tournament.json`.
La GitHub Action `sync.yml` corre ese mismo comando todas las noches (23:00, hora de Argentina) y commitea si cambió algún resultado.

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
