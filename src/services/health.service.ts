import { prisma } from "../config/prisma.js";

export async function isDatabaseUp() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
