import { client } from "./initDB";

export async function withPostgresAdvisoryLock<T>(
  lockKey: string,
  operation: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const connection = await client.reserve();
  let acquired = false;
  try {
    const [result] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${lockKey}, 0)) as acquired
    `;
    acquired = result.acquired;
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await operation() };
  } finally {
    try {
      if (acquired) {
        await connection`
          select pg_advisory_unlock(hashtextextended(${lockKey}, 0))
        `;
      }
    } finally {
      connection.release();
    }
  }
}
