/** Entry point del proceso: arma la app (`app.ts`) y la pone a escuchar. Separado de `app.ts` para que los tests puedan importar `buildApp` sin abrir un puerto. */
import { env } from './config/env.js';
import { buildApp } from './app.js';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`Server running at http://${env.HOST}:${env.PORT}`);
    console.log(`API docs at http://${env.HOST}:${env.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
