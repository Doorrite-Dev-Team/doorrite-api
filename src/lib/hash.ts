// src/lib/hash.ts
import argon2 from "argon2";

export async function hashPassword(plain: string) {
  return await argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string) {
  return await argon2.verify(hash, plain);
}
