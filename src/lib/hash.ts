// src/lib/hash.ts
import argon2 from "argon2";

export async function hashPassword(plain: string) {
  return await argon2.hash(plain, { type: argon2.argon2id });
}

// Verify expects (plain, hash) for convenience at call sites.
export async function verifyPassword(plain: string, hash: string) {
  return await argon2.verify(hash, plain);
}
