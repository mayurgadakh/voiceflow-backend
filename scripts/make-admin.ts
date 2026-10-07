import "dotenv/config";
import { prisma } from "../src/config/prisma.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

await prisma.user.update({ where: { email }, data: { role: "admin" } });
console.log(`${email} is now an admin`);
await prisma.$disconnect();
