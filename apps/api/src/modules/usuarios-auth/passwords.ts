/**
 * Hashing de contraseñas de usuario final (CUIT + contraseña, ver
 * `service.ts`). Reusa `argon2` (ya dependencia del proyecto — el
 * `modules/auth` viejo la usaba para las API keys B2B, ver PLAN.md "Qué se
 * reemplaza") con los defaults del paquete (Argon2id, sin opciones
 * explícitas), que ya son un perfil razonable para 2026 (RFC 9106
 * recomienda Argon2id como variante por defecto para hashing de
 * contraseñas).
 *
 * Separado de `tokens.ts` (JWT + refresh token) a propósito: son dos
 * primitivas criptográficas con motivos y tiempos de vida completamente
 * distintos (una contraseña vive años y la elige un humano con entropía
 * baja; un token lo generamos nosotros con un CSPRNG y vive minutos/días) —
 * mezclarlas en el mismo archivo no aporta nada y hace más fácil confundir
 * cuál hash lento (argon2) usar dónde.
 */
import * as argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/**
 * Nunca lanza por un hash corrupto o con formato inesperado — devuelve
 * `false`. Esto es deliberado: `service.ts` usa esta función tanto para la
 * verificación real como para el "hash de relleno" que evita el timing
 * oracle de CUIT inexistente (ver `service.ts` — `DUMMY_PASSWORD_HASH`), y
 * en ningún caso corresponde tumbar el request completo con un 500 por un
 * dato de contraseña con forma rara — es indistinguible de "la contraseña
 * no matchea" desde la perspectiva de quien llama.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
