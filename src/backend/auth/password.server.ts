import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

// scrypt via node:crypto: no native dependency to build on the host. The cost parameters are
// stored inside each hash, so they can be raised later without invalidating existing passwords.
const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function derive(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, params, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash to verify against when the account does not exist, so a missing account and a
// wrong password take the same time and cannot be told apart.
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash.then((hash) => verifyPassword(password, hash));
}

// Returns a message for the first problem found, or null when the password is acceptable.
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (new Set(password).size < 4) return "That password is too repetitive.";
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return "Your password cannot be your email address.";
  }
  return null;
}

// Readable alphabet: no 0/O, 1/l/I. Used for temporary passwords that are handed over once.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
