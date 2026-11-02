// Dev only: creates a test user + session so the API can be tried with curl before Google login is wired up.
import { env } from '../config';
import { prisma } from '../db';
import { redis } from '../redis';
import { newSession, SID } from '../session';

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('dev-session is disabled in production');
  const email = process.argv[2] ?? 'dev@example.com';
  const user = await prisma.user.upsert({
    where: { googleId: `dev:${email}` },
    create: { googleId: `dev:${email}`, email, name: 'Dev User' },
    update: {},
  });
  const sid = await newSession(user.id);
  console.log(`user ${user.id} (${email})\ncookie: ${SID}=${sid}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit();
    await prisma.$disconnect();
  });
